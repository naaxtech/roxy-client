// RevenueCat webhook → Roxy Supporter entitlement.
//
// Pure apart from the injected `apply` (the apply_supporter_event RPC) and
// `log`, so every rule is unit-tested (_shared/revenuecat.test.ts) and
// revenuecat-webhook/index.ts is wiring only.
//
// This module owns everything RevenueCat-specific: who the member is, which
// events concern the Supporter entitlement, and what each event type MEANS.
// It reduces an event to one effect; migration 140's apply_supporter_event
// owns the state machine (idempotency, event-time guard, transfer).
//
// RevenueCat docs read 2026-10-26:
//   W  = https://www.revenuecat.com/docs/integrations/webhooks
//   F  = https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
//   S  = https://www.revenuecat.com/docs/integrations/webhooks/sample-events
//   FL = https://www.revenuecat.com/docs/integrations/webhooks/event-flows

import { bearerToken, constantTimeEqual } from './serviceAuth.ts';
import { errorResponse, successResponse } from './errorHandler.ts';

/**
 * The RevenueCat entitlement identifier both Supporter products attach to.
 * The owner creates it in the RevenueCat dashboard with exactly this id; an
 * event for any other entitlement is logged and changes nothing.
 */
export const SUPPORTER_ENTITLEMENT = 'supporter';

/** A shorter REVENUECAT_WEBHOOK_SECRET is treated as not configured (fail closed). */
export const MIN_SECRET_LENGTH = 16;

export type Effect = 'activate' | 'grace' | 'expire' | 'refund' | 'cancel' | 'change' | 'transfer' | 'log';

/** Named arguments of public.apply_supporter_event (migration 140), in its order. */
export type ApplyArgs = {
  p_event_id: string;
  p_type: string;
  p_effect: Effect;
  p_user_id: string | null;
  p_event_at: string;
  p_environment: 'sandbox' | 'production' | null;
  p_period_ends_at: string | null;
  p_store: string | null;
  p_product_id: string | null;
  p_original_transaction_ref: string | null;
  p_from_user_ids: string[] | null;
  p_payload: Record<string, unknown>;
};

export type ApplyFn = (
  args: ApplyArgs,
) => Promise<{ data: string | null; error: { code?: string; message: string } | null }>;

export type LogFn = (level: 'info' | 'error', msg: string, fields: Record<string, unknown>) => void;

type Obj = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const STORE_RE = /^[A-Za-z_]{1,32}$/;
const MAX_DATE_MS = 8.64e15; // the largest instant a JS Date can hold

// src: F · 2026-10-26 — INITIAL_PURCHASE (new purchase), RENEWAL (renewed, or a
// lapsed user resubscribed), UNCANCELLATION (re-enabled before expiry),
// NON_RENEWING_PURCHASE, SUBSCRIPTION_EXTENDED (expiration pushed back),
// REFUND_REVERSED (a refund was reversed): each leaves her entitled.
const ACTIVATING = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
  'REFUND_REVERSED',
]);

/** Effects that write a subscription row (the rest are logged only, or move rows). */
const CHANGES_STATE = new Set<Effect>(['activate', 'grace', 'expire', 'refund']);

// What support and refunds need from an event, and nothing else. Left out on
// purpose: subscriber_attributes (RevenueCat puts $email, $phoneNumber,
// $displayName and ad ids there — S: "$email": {...}), country_code (location
// is on the CLAUDE.md §10 never-log list), Web Billing metadata (free text),
// experiments, and any field RevenueCat adds later until someone chooses it.
const STORED_FIELDS = [
  'id', 'type', 'event_timestamp_ms', 'app_id',
  'app_user_id', 'original_app_user_id', 'aliases', 'transferred_from', 'transferred_to',
  'product_id', 'new_product_id', 'entitlement_ids', 'period_type', 'presented_offering_id', 'offer_code',
  'purchased_at_ms', 'expiration_at_ms', 'grace_period_expiration_at_ms',
  'environment', 'store', 'transaction_id', 'original_transaction_id', 'is_family_share', 'renewal_number',
  'cancel_reason', 'expiration_reason',
  'price', 'price_in_purchased_currency', 'currency',
  'takehome_percentage', 'tax_percentage', 'commission_percentage',
] as const;

function storedPayload(apiVersion: unknown, ev: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { api_version: apiVersion ?? null };
  for (const k of STORED_FIELDS) if (k in ev) out[k] = ev[k];
  return out;
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asUuid(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null;
}

function uniqUuids(list: unknown[]): string[] {
  const out: string[] = [];
  for (const v of list) {
    const u = asUuid(v);
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

function msToIso(v: unknown): string | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= MAX_DATE_MS
    ? new Date(v).toISOString()
    : null;
}

function shortText(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.length >= 1 && v.length <= max ? v : null;
}

// src: F · 2026-10-26 — environment is "SANDBOX" or "PRODUCTION".
function environmentOf(v: unknown): 'sandbox' | 'production' | null {
  if (v === 'PRODUCTION') return 'production';
  if (v === 'SANDBOX') return 'sandbox';
  return null;
}

// src: F · 2026-10-26 — store is "sometimes" present: AMAZON, APP_STORE,
// MAC_APP_STORE, PADDLE, PLAY_STORE, PROMOTIONAL, RC_BILLING, ROKU, STRIPE,
// TEST_STORE. Stored lower-cased; an unknown store is kept, not rejected.
function storeOf(v: unknown): string | null {
  return typeof v === 'string' && STORE_RE.test(v) ? v.toLowerCase() : null;
}

/**
 * Checks the Authorization header against REVENUECAT_WEBHOOK_SECRET.
 * src: W · 2026-10-26 — the header value is whatever we configure in the
 * dashboard, sent on every request; "Your server should verify the validity
 * of the authorization header for every notification."
 * Accepted: the configured value verbatim, or `Bearer <secret>` (so the
 * dashboard may hold either form). Constant time; an unset or short secret
 * rejects everyone.
 */
export function checkAuthorization(
  header: string | null | undefined,
  secret: string | null | undefined,
): 'ok' | 'unauthorized' | 'unconfigured' {
  const key = (secret ?? '').trim();
  if (key.length < MIN_SECRET_LENGTH) return 'unconfigured';
  if (!header) return 'unauthorized';
  const value = header.trim();
  const token = bearerToken(value);
  // Both compares always run: no early exit on which form matched.
  const verbatim = constantTimeEqual(value, key);
  const bearer = token !== null && constantTimeEqual(token, key);
  return verbatim || bearer ? 'ok' : 'unauthorized';
}

/**
 * The member an event is about. The app configures the SDK with her Supabase
 * user id, so `app_user_id` is that uuid.
 * src: F · 2026-10-26 — app_user_id is the most recently seen App User ID,
 * original_app_user_id the first, aliases every id the subscriber has used.
 * Otherwise exactly one distinct uuid among the others; two different
 * members on one subscriber is refused rather than guessed.
 */
export function resolveUserId(ev: Obj): string | null {
  const primary = asUuid(ev.app_user_id);
  if (primary) return primary;
  const aliases = Array.isArray(ev.aliases) ? ev.aliases : [];
  const others = uniqUuids([ev.original_app_user_id, ...aliases]);
  return others.length === 1 ? others[0] : null;
}

/** What an event does to her Supporter entitlement. */
export function effectFor(ev: Obj): Effect {
  const type = ev.type;
  // src: F · 2026-10-26 — TRANSFER: "Transactions and entitlements were
  // transferred between App User IDs. Sent only for the destination user."
  // It carries no entitlement_ids; only an existing Supporter row can move.
  if (type === 'TRANSFER') return 'transfer';
  // src: F · 2026-10-26 — TEST is a dashboard test event.
  if (type === 'TEST') return 'log';

  // src: F · 2026-10-26 — entitlement_ids is always present and can be null.
  const entitlements = Array.isArray(ev.entitlement_ids) ? ev.entitlement_ids : [];
  if (!entitlements.includes(SUPPORTER_ENTITLEMENT)) return 'log';

  if (typeof type === 'string' && ACTIVATING.has(type)) return 'activate';
  switch (type) {
    // src: F · 2026-10-26 — BILLING_ISSUE: a charge failed; "the subscription
    // hasn't necessarily expired" (store grace period).
    case 'BILLING_ISSUE':
      return 'grace';
    // src: F · 2026-10-26 — EXPIRATION: "the user's access should be removed".
    case 'EXPIRATION':
      return 'expire';
    // src: FL · 2026-10-26 — an immediate change is dispatched alongside a
    // RENEWAL (App Store) or INITIAL_PURCHASE (Play); a deferred one keeps the
    // original entitlement until the next RENEWAL. Those carry the period.
    case 'PRODUCT_CHANGE':
      return 'change';
    // src: F · 2026-10-26 — refunds have no event type of their own: they are
    // a CANCELLATION with cancel_reason CUSTOMER_SUPPORT, and "refunds can be
    // given without canceling a subscription. Check the current subscription
    // status". The event's expiration_at_ms is that status: in the refund
    // sample (S) it was moved to before the event — access ended. So a refund
    // revokes only when expiration is null (a lifetime purchase) or not after
    // the event; a refund leaving the period running (goodwill / partial) is
    // informational, like any other cancellation, which keeps her entitled to
    // the period end.
    case 'CANCELLATION': {
      if (ev.cancel_reason !== 'CUSTOMER_SUPPORT') return 'cancel';
      const exp = ev.expiration_at_ms;
      const at = ev.event_timestamp_ms;
      const ended = exp === null || (typeof exp === 'number' && typeof at === 'number' && exp <= at);
      return ended ? 'refund' : 'cancel';
    }
  }
  // SUBSCRIPTION_PAUSED ("don't revoke access"), TEMPORARY_ENTITLEMENT_GRANT
  // (store not yet validated; the purchase event follows), INVOICE_ISSUANCE,
  // and any type RevenueCat adds later: recorded, nothing granted or revoked.
  return 'log';
}

export type ParseResult = { ok: true; args: ApplyArgs } | { ok: false; error: string };

const bad = (error: string): ParseResult => ({ ok: false, error });

function build(
  common: Pick<ApplyArgs, 'p_event_id' | 'p_type' | 'p_effect' | 'p_event_at' | 'p_payload'>,
  rest: Omit<ApplyArgs, 'p_event_id' | 'p_type' | 'p_effect' | 'p_event_at' | 'p_payload'>,
): ApplyArgs {
  // Key order mirrors the SQL signature.
  return {
    p_event_id: common.p_event_id,
    p_type: common.p_type,
    p_effect: common.p_effect,
    p_user_id: rest.p_user_id,
    p_event_at: common.p_event_at,
    p_environment: rest.p_environment,
    p_period_ends_at: rest.p_period_ends_at,
    p_store: rest.p_store,
    p_product_id: rest.p_product_id,
    p_original_transaction_ref: rest.p_original_transaction_ref,
    p_from_user_ids: rest.p_from_user_ids,
    p_payload: common.p_payload,
  };
}

/**
 * Validates a webhook body and turns it into apply_supporter_event arguments.
 * src: F · 2026-10-26 — the POST body is { api_version, event }; event.id and
 * event.event_timestamp_ms are always present and reused on retries.
 * Error strings name the field only, never its value.
 */
export function parseWebhook(input: unknown): ParseResult {
  if (!isObj(input)) return bad('body');
  const apiVersion = input.api_version;
  // The documented refund sample omits api_version; a different major is a shape we do not know.
  if (apiVersion !== undefined && !(typeof apiVersion === 'string' && /^1(\.|$)/.test(apiVersion))) {
    return bad('api_version');
  }
  const ev = input.event;
  if (!isObj(ev)) return bad('event');

  const id = ev.id;
  if (typeof id !== 'string' || id.length < 1 || id.length > 128) return bad('event.id');
  const type = ev.type;
  if (typeof type !== 'string' || !TYPE_RE.test(type)) return bad('event.type');
  const eventAt = msToIso(ev.event_timestamp_ms);
  if (eventAt === null) return bad('event.event_timestamp_ms');

  const effect = effectFor(ev);
  const environment = environmentOf(ev.environment);
  // src: F · 2026-10-26 — TRANSFER has environment only "sometimes".
  const stateful = effect !== 'log' && effect !== 'transfer';
  if (stateful && environment === null) return bad('event.environment');

  const payload = storedPayload(apiVersion, ev);

  const common = { p_event_id: id, p_type: type, p_effect: effect, p_event_at: eventAt, p_payload: payload };

  if (effect === 'transfer') {
    // src: F · 2026-10-26 — transferred_from / transferred_to: String arrays, always present.
    const from = ev.transferred_from;
    const to = ev.transferred_to;
    if (!Array.isArray(from) || !from.every((v) => typeof v === 'string')) return bad('event.transferred_from');
    if (!Array.isArray(to) || !to.every((v) => typeof v === 'string')) return bad('event.transferred_to');
    const destinations = uniqUuids(to);
    const destination = destinations.length === 1 ? destinations[0] : null;
    return {
      ok: true,
      args: build(common, {
        p_user_id: destination,
        p_environment: environment,
        p_period_ends_at: null,
        p_store: storeOf(ev.store),
        p_product_id: null,
        p_original_transaction_ref: null,
        p_from_user_ids: uniqUuids(from).filter((u) => u !== destination),
      }),
    };
  }

  // A state change must name the subscription it changes (migration 140 keys
  // on original_transaction_id, else product). Informational events need not.
  const productId = shortText(ev.product_id);
  const originalRef = shortText(ev.original_transaction_id);
  if (CHANGES_STATE.has(effect) && productId === null && originalRef === null) {
    return bad('event.original_transaction_id');
  }

  let period: string | null = null;
  if (stateful) {
    // src: F · 2026-10-26 — expiration_at_ms is always present; null "for
    // non-subscription purchases or lifetime products". Absent ≠ null here.
    const exp = ev.expiration_at_ms;
    if (exp === undefined) return bad('event.expiration_at_ms');
    const expIso = exp === null ? null : msToIso(exp);
    if (exp !== null && expIso === null) return bad('event.expiration_at_ms');

    if (effect === 'grace') {
      // src: F · 2026-10-26 — grace_period_expiration_at_ms: only on
      // BILLING_ISSUE, always present there, can be null (no grace period).
      const g = ev.grace_period_expiration_at_ms;
      const graceIso = g === undefined || g === null ? null : msToIso(g);
      if (g !== undefined && g !== null && graceIso === null) return bad('event.grace_period_expiration_at_ms');
      period = graceIso ?? expIso;
    } else if (effect === 'activate') {
      period = expIso ?? 'infinity';
    } else {
      period = expIso;
    }
  }

  return {
    ok: true,
    args: build(common, {
      p_user_id: resolveUserId(ev),
      p_environment: environment,
      p_period_ends_at: period,
      p_store: storeOf(ev.store),
      p_product_id: productId,
      p_original_transaction_ref: originalRef,
      p_from_user_ids: null,
    }),
  };
}

// Edge-function logs (Supabase captures stdout/stderr). Level-routed; the
// fields never include a member id (see handleRevenueCatWebhook).
const defaultLog: LogFn = (level, msg, fields) => {
  const line = JSON.stringify({ msg, ...fields });
  if (level === 'error') console.error(line);
  else console.info(line);
};

/**
 * The whole request cycle. Status codes are chosen for RevenueCat's retry
 * policy — src: W · 2026-10-26: anything but 200 is a failure, retried 5
 * times (≈2.5, 5, 10, 20, 40 min), and a response must finish within 60 s.
 *   405 not POST · 503 secret not configured · 401 bad Authorization
 *   400 malformed body (a shape we refuse; RC retries, the dashboard shows it)
 *   500 the database failed (a retry may succeed)
 *   200 applied | duplicate | stale | logged | unknown_user
 * Logs carry type, effect, result and error code only — never a member id,
 * an alias, or a database error message (those can quote ids).
 */
export async function handleRevenueCatWebhook(
  req: Request,
  deps: { secret: string | null | undefined; apply: ApplyFn; log?: LogFn },
): Promise<Response> {
  const log = deps.log ?? defaultLog;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const auth = checkAuthorization(req.headers.get('Authorization'), deps.secret);
  if (auth === 'unconfigured') {
    log('error', 'revenuecat-webhook: REVENUECAT_WEBHOOK_SECRET missing or too short', { min_length: MIN_SECRET_LENGTH });
    return errorResponse('Webhook not configured', 503);
  }
  if (auth === 'unauthorized') return errorResponse('Unauthorized', 401);

  let input: unknown;
  try {
    input = JSON.parse(await req.text());
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const parsed = parseWebhook(input);
  // `=== false`, not `!parsed.ok`: Deno type-checks with the repo-root
  // tsconfig (Expo base, strictNullChecks off), where `!x.ok` does not narrow.
  if (parsed.ok === false) {
    log('error', 'revenuecat-webhook: rejected payload', { field: parsed.error });
    return errorResponse(`Invalid payload: ${parsed.error}`, 400);
  }
  const { p_type: type, p_effect: effect } = parsed.args;

  let outcome: Awaited<ReturnType<ApplyFn>>;
  try {
    outcome = await deps.apply(parsed.args);
  } catch {
    outcome = { data: null, error: { code: 'apply_threw', message: '' } };
  }
  if (outcome.error || typeof outcome.data !== 'string') {
    log('error', 'revenuecat-webhook: apply failed', { type, effect, code: outcome.error?.code ?? 'no_result' });
    return errorResponse('Could not record the event', 500);
  }

  log('info', 'revenuecat-webhook: event', { type, effect, result: outcome.data });
  return successResponse({ result: outcome.data });
}
