'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { assertStaffAction, assertUuid } from '@/lib/staff-guard';
import {
  RESOLUTION_CHOICES,
  RESOLUTION_NOTE_MAX,
  resolutionFor,
  resolveErrorMessage,
  resolveSuccessMessage,
  type ResolutionChoice,
  type ResolveResult,
} from '@/lib/reports';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Resolve one report through staff_resolve_report (migration 131).
 *
 * The RPC re-checks is_roxy_staff(), hides the content, closes every pending
 * report about the same target, optionally suspends the reported member and
 * audits it — all in one transaction. This action is only the first gate and
 * the honest messenger: it returns what the server did, or why it refused.
 */
export async function resolveReport(
  reportId: string,
  choice: ResolutionChoice,
  note: string,
): Promise<ActionResult> {
  await assertStaffAction();

  let id: string;
  try {
    id = assertUuid(reportId, 'report id');
  } catch {
    return { ok: false, error: 'That report id is not valid.' };
  }
  if (!(RESOLUTION_CHOICES as readonly string[]).includes(choice)) {
    return { ok: false, error: 'Choose dismiss, action, hide or suspend.' };
  }
  const args = resolutionFor(choice);
  if (!args) return { ok: false, error: 'Choose dismiss, action, hide or suspend.' };

  const trimmed = typeof note === 'string' ? note.trim() : '';
  if (trimmed.length > RESOLUTION_NOTE_MAX) {
    return { ok: false, error: `Keep the note under ${RESOLUTION_NOTE_MAX} characters.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('staff_resolve_report', {
    p_report_id: id,
    p_action: args.p_action,
    p_note: trimmed === '' ? null : trimmed,
    p_suspend_author: args.p_suspend_author,
  });
  if (error) return { ok: false, error: resolveErrorMessage(error) };

  revalidatePath('/staff/reports');
  revalidatePath('/staff');
  return { ok: true, message: resolveSuccessMessage(data as ResolveResult) };
}
