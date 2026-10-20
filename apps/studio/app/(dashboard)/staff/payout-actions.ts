'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { assertStaffAction, assertUuid } from '@/lib/staff-guard';
import { callEdgeAsService } from '@/lib/staff-auth';
import {
  payoutBlockMessage,
  payoutErrorMessage,
  releaseOutcome,
  validatePayoutReason,
  type ReleaseCounts,
} from '@/lib/payouts';

export type PayoutResult = { ok: true; message: string } | { ok: false; error: string };

function eventId(value: string): string | null {
  try {
    return assertUuid(value, 'event id');
  } catch {
    return null;
  }
}

/**
 * Block or unblock an event payout through staff_set_payout_block (131).
 * Core only — checked here and again by the RPC (is_roxy_core()). The old
 * /api/staff/block-payout updated `events` directly: a non-core staff update
 * matched 0 rows under events_update_core and still answered success, and its
 * audit insert had no policy, so it failed silently too (ST-03, SB-12).
 */
export async function setPayoutBlock(eventIdValue: string, blocked: boolean, reason: string): Promise<PayoutResult> {
  const viewer = await assertStaffAction();
  if (!viewer.isCore) return { ok: false, error: 'Only core staff can change a payout.' };
  const id = eventId(eventIdValue);
  if (!id) return { ok: false, error: 'That event id is not valid.' };
  if (typeof blocked !== 'boolean') return { ok: false, error: 'Block or unblock?' };
  const input = validatePayoutReason(reason);
  if (!input.ok) return input;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('staff_set_payout_block', {
    p_event_id: id,
    p_blocked: blocked,
    p_reason: input.reason,
  });
  if (error) return { ok: false, error: payoutErrorMessage(error) };

  revalidatePath('/staff');
  return { ok: true, message: payoutBlockMessage(blocked, data as { changed?: boolean } | null) };
}

/**
 * Release one event's payout now. Core only. The release-payout edge function
 * runs with the service role (server-side only — the key never reaches the
 * browser) and re-checks completion, the waiting period and the block itself;
 * this reports what it actually did instead of treating HTTP 200 as "paid".
 */
export async function releasePayout(eventIdValue: string): Promise<PayoutResult> {
  const viewer = await assertStaffAction();
  if (!viewer.isCore) return { ok: false, error: 'Only core staff can release a payout.' };
  const id = eventId(eventIdValue);
  if (!id) return { ok: false, error: 'That event id is not valid.' };

  const res = await callEdgeAsService('release-payout', { event_id: id });
  if (!res.ok) {
    return { ok: false, error: `The payout service did not answer (${res.status}). Nothing was paid — try again.` };
  }
  const outcome = releaseOutcome(res.data as ReleaseCounts | null);
  if (outcome.ok) revalidatePath('/staff');
  return outcome;
}
