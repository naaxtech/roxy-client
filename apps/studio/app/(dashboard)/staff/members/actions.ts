'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { assertStaffAction, assertUuid } from '@/lib/staff-guard';
import { memberErrorMessage, validateLift, validateSuspension } from '@/lib/members';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function memberId(value: string): string | null {
  try {
    return assertUuid(value, 'member id');
  } catch {
    return null;
  }
}

/**
 * Suspend a member through suspend_member() (migration 131). Any staff may
 * suspend a member; the RPC itself refuses a staff target unless the caller is
 * core, refuses self-suspension and double suspension.
 *
 * An end date is sent as p_until. The 131 RPC has no such parameter yet
 * (cross-lane request in the ops2 summary), so PostgREST answers PGRST202 for
 * that signature and NOTHING is suspended — the member is told exactly that
 * instead of being suspended forever when staff asked for a week.
 */
export async function suspendMember(userId: string, reason: string, untilDate: string): Promise<ActionResult> {
  await assertStaffAction();
  const id = memberId(userId);
  if (!id) return { ok: false, error: 'That member id is not valid.' };

  const input = validateSuspension(reason, untilDate);
  if (!input.ok) return input;

  const supabase = await createClient();
  const args: Record<string, string> = { p_user_id: id, p_reason: input.reason };
  if (input.until) args.p_until = input.until;
  const { error } = await supabase.rpc('suspend_member', args);
  if (error) {
    if (input.until && (error.code === 'PGRST202' || error.code === '42883')) {
      return {
        ok: false,
        error:
          'This database cannot end a suspension on a date yet. Nothing was changed. Suspend without an end date and set a reminder to lift it.',
      };
    }
    return { ok: false, error: memberErrorMessage(error) };
  }

  revalidatePath('/staff/members');
  revalidatePath(`/staff/members/${id}`);
  return {
    ok: true,
    message: input.until
      ? `Suspended until ${input.until.slice(0, 10)}. She is signed out everywhere.`
      : 'Suspended. She is signed out everywhere and cannot sign back in.',
  };
}

/** Lift a suspension. Core only — checked here and again by the RPC. */
export async function unsuspendMember(userId: string, note: string): Promise<ActionResult> {
  const viewer = await assertStaffAction();
  if (!viewer.isCore) return { ok: false, error: 'Only core staff can lift a suspension.' };
  const id = memberId(userId);
  if (!id) return { ok: false, error: 'That member id is not valid.' };

  const input = validateLift(note);
  if (!input.ok) return input;

  const supabase = await createClient();
  const { error } = await supabase.rpc('unsuspend_member', { p_user_id: id, p_note: input.note });
  if (error) return { ok: false, error: memberErrorMessage(error) };

  revalidatePath('/staff/members');
  revalidatePath(`/staff/members/${id}`);
  return { ok: true, message: 'Suspension lifted. She can sign in again.' };
}
