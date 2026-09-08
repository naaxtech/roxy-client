import { getSupabaseClient } from './auth.ts';

/**
 * What to do when the limiter ITSELF fails — a DB timeout, a network fault, a
 * pool exhaustion. There is deliberately no default, because there is no answer
 * that is right for every caller and the wrong one is invisible.
 *
 * `'allow'` — serve the request. Correct where refusing costs a woman something
 *   that matters more than the resource being capped. `submit-report` is the
 *   clearest case: a woman reporting abuse must never be blocked by our database
 *   having a bad second. A duplicate report costs a moderator ten seconds; a
 *   refused one costs her the report.
 *
 * `'deny'` — refuse. Correct where the cap guards money or a one-shot lifetime
 *   allowance, and where she can simply try again in a moment.
 *
 * Every `'allow'` site logs the failure. An allow-on-failure that is silent is
 * indistinguishable from the fail-open this module was rewritten to remove.
 */
export type LimiterFailurePolicy = 'deny' | 'allow';

export interface RateLimitOutcome {
  allowed: boolean;
  currentCount: number;
  /** The consumed slot, for `refundRateLimit`. Null when nothing was consumed. */
  callId: string | null;
  /**
   * True when `allowed` came from the failure policy rather than from a count.
   * Callers that report limit state to the client must not present a degraded
   * result as a real one.
   */
  degraded: boolean;
}

interface ConsumeRow {
  allowed: boolean;
  current_count: number;
  call_id: string | null;
}

/**
 * Counts and records one call against a cap, atomically.
 *
 * ## Why this replaced `checkRateLimit` + `logAiCall`
 *
 * The old pair split one decision into two exported functions: one counted rows
 * in `ai_call_log`, the other wrote them. Nothing made a caller do both, and
 * **six of the twelve callers never did** — `cancel-event`,
 * `create-payment-intent`, `gdpr-delete`, `gdpr-export`, `stripe-dashboard-link`
 * and `submit-report`. Because the count filters on `function_name`, rows
 * written by the other six did not help: each of those six counted a set that
 * was empty by construction, so `count` was 0, `0 < maxCount` held, and the
 * limiter allowed. Checked against production on 2026-08-07: 78 rows across five
 * function names, and not one of the six appears. Their `429` branches had never
 * executed.
 *
 * Two more fail-open defects lived in the same file:
 *
 *  - `const { count } = await query` discarded `error`. Any PostgREST failure
 *    made `count` null, `count ?? 0` zero, and the limiter allowed — for all
 *    twelve callers, not six. That is why `error` is checked below before `data`
 *    is trusted, and why the failure has a named policy instead of a silent one.
 *  - The check and the write were separate round trips with the guarded work in
 *    between, so two concurrent requests both read `count = 9` against a cap of
 *    10 and both proceeded.
 *
 * The fix is structural rather than careful: recording is not a step a caller
 * can omit, it is how the answer is computed. There is no way to ask this module
 * "am I under the cap" without consuming.
 *
 * ## Ordering
 *
 * Consume BEFORE the guarded work, and `refundRateLimit` if the work never
 * reached the resource. Recording per attempt rather than per success is the
 * safe direction — forgetting the refund costs that woman one slot, where the
 * old design's forgetful path cost the platform the entire cap.
 *
 * src: supabase/migrations/091_consume_rate_limit.sql
 */
export async function consumeRateLimit(params: {
  userId: string;
  fnName: string;
  maxCount: number;
  windowType: 'daily' | 'lifetime' | 'conversation';
  conversationId?: string;
  wasMock?: boolean;
  onLimiterFailure: LimiterFailurePolicy;
}): Promise<RateLimitOutcome> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.rpc('consume_rate_limit', {
    p_user_id: params.userId,
    p_fn_name: params.fnName,
    p_max_count: params.maxCount,
    p_window_type: params.windowType,
    p_conversation_id: params.conversationId ?? null,
    p_was_mock: params.wasMock ?? false,
  });

  // supabase-js resolves with `{ data, error }` and does not throw, so an
  // unchecked call here would read `data` as null and sail on. That is the exact
  // shape of the defect this module replaced.
  //
  // An empty array counts as a failure too: the SQL function always returns
  // exactly one row, so zero rows means something upstream rewrote or lost the
  // response, and a limiter must not infer "allowed" from an answer it did not
  // receive.
  const row = (data as ConsumeRow[] | null)?.[0];
  if (error || !row) {
    const detail = error?.message ?? 'limiter returned no row';
    // fnName is a constant in every caller; userId is never logged — a user id
    // in a log is PII under the observability rules and must be hashed first.
    console.error(
      `[rateLimit] ${params.fnName}: limiter unavailable (${detail}) — ` +
        `applying policy '${params.onLimiterFailure}'`,
    );
    return {
      allowed: params.onLimiterFailure === 'allow',
      currentCount: 0,
      callId: null,
      degraded: true,
    };
  }

  return {
    allowed: row.allowed,
    currentCount: row.current_count,
    callId: row.call_id,
    degraded: false,
  };
}

/**
 * Releases a slot consumed by {@link consumeRateLimit} when the guarded work
 * never reached the resource the cap protects.
 *
 * Best-effort by design: it never throws and never reports failure upward. A
 * caller reaching this point is already on its own error path, and turning a
 * handled failure into an unhandled one to report that a refund did not land
 * would be the wrong trade. A refund that silently fails costs that woman one
 * slot; the alternative costs her the error message she was about to be shown.
 *
 * Where it matters most is a small cap. `roxy-onboarding` is LIFETIME, max 1:
 * without this, a single transient Anthropic 500 locks a woman out of her
 * onboarding recommendations permanently.
 *
 * Safe to call with a null `callId` — a refused request consumed nothing, so
 * callers need no branch of their own.
 */
export async function refundRateLimit(userId: string, callId: string | null): Promise<void> {
  if (!callId) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('refund_rate_limit', {
    p_user_id: userId,
    p_call_id: callId,
  });

  if (error) {
    console.error(`[rateLimit] refund failed (${error.message}) — one slot stays consumed`);
  }
}
