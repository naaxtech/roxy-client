/**
 * Event payout ops: pure validation and wording.
 *
 * Blocking/unblocking goes through staff_set_payout_block() (migration 131):
 * core only, reason required, audited, and it says whether anything changed.
 * Releasing is the release-payout edge function, which answers
 * { released, skipped, failed } — only `released > 0` means money moved.
 */

export const PAYOUT_REASON_MIN = 3;
export const PAYOUT_REASON_MAX = 1000;

export function validatePayoutReason(reason: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < PAYOUT_REASON_MIN || r.length > PAYOUT_REASON_MAX) {
    return { ok: false, error: `Give a reason (${PAYOUT_REASON_MIN} to ${PAYOUT_REASON_MAX} characters).` };
  }
  return { ok: true, reason: r };
}

export function payoutBlockMessage(blocked: boolean, result: { changed?: boolean } | null): string {
  const changed = Boolean(result?.changed);
  if (blocked) {
    return changed
      ? 'Payout blocked. It will not be released until core staff unblock it.'
      : 'This payout was already blocked. Nothing changed.';
  }
  return changed
    ? 'Payout unblocked. It is released once its waiting period has passed.'
    : 'This payout was not blocked. Nothing changed.';
}

export interface ReleaseCounts {
  released?: number;
  skipped?: number;
  failed?: number;
}

export function releaseOutcome(counts: ReleaseCounts | null | undefined):
  | { ok: true; message: string }
  | { ok: false; error: string } {
  const released = Number(counts?.released ?? 0);
  const failed = Number(counts?.failed ?? 0);
  if (released > 0) return { ok: true, message: 'Payout released to the host.' };
  if (failed > 0) {
    return {
      ok: false,
      error: 'Stripe refused the transfer. Nothing was paid; check the host’s Stripe account and try again.',
    };
  }
  return {
    ok: false,
    error:
      'Not released. The event is not completed, its waiting period has not passed, it is blocked, it was already paid, or the host cannot receive payouts yet.',
  };
}

interface RpcError {
  code?: string;
  message?: string;
}

export function payoutErrorMessage(error: RpcError): string {
  const code = error.code ?? '';
  if (code === 'PGRST202' || code === '42883') {
    return 'Payout controls need migration 131 on this database. Nothing was changed.';
  }
  if (code === '42501') return 'Only core staff can change a payout.';
  if (['22023', '55000', 'P0002'].includes(code) && error.message) return error.message;
  return 'That did not go through. Nothing was changed — try again.';
}
