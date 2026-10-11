/**
 * Studio member lookup + suspension: pure validation and wording.
 *
 * Suspension itself lives in the database (migration 131): suspend_member()
 * bans the auth user, deletes her sessions and refresh tokens and writes the
 * audit row; unsuspend_member() is core-only. These helpers make the form
 * reject bad input before a round trip and turn RPC refusals into words.
 */
import { endOfUtcDayIso } from '@/lib/dates';

export const SUSPEND_REASON_MIN = 3;
export const SUSPEND_REASON_MAX = 2000;
export const LIFT_NOTE_MAX = 2000;
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 120;

export type SuspensionInput =
  | { ok: true; reason: string; until: string | null }
  | { ok: false; error: string };

export function validateSuspension(reason: unknown, untilDate: unknown, now: Date = new Date()): SuspensionInput {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < SUSPEND_REASON_MIN) {
    return { ok: false, error: `Give a reason (at least ${SUSPEND_REASON_MIN} characters).` };
  }
  if (r.length > SUSPEND_REASON_MAX) {
    return { ok: false, error: `Keep the reason under ${SUSPEND_REASON_MAX} characters.` };
  }
  const d = typeof untilDate === 'string' ? untilDate.trim() : '';
  if (d === '') return { ok: true, reason: r, until: null };
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(d) ? endOfUtcDayIso(d) : null;
  if (!iso) return { ok: false, error: 'That end date could not be read. Pick it again.' };
  if (new Date(iso).getTime() <= now.getTime()) {
    return { ok: false, error: 'The end date has to be in the future.' };
  }
  return { ok: true, reason: r, until: iso };
}

export function validateLift(note: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  const n = typeof note === 'string' ? note.trim() : '';
  if (n.length > LIFT_NOTE_MAX) return { ok: false, error: `Keep the note under ${LIFT_NOTE_MAX} characters.` };
  return { ok: true, note: n === '' ? null : n };
}

interface RpcError {
  code?: string;
  message?: string;
}

/** The RPCs raise deliberate wording for 42501 / 22023 / 23505 / P0002. */
export function memberErrorMessage(error: RpcError): string {
  const code = error.code ?? '';
  if (code === 'PGRST202' || code === '42883') {
    return 'Member tools are not live on this database yet (migration 131). Nothing was changed.';
  }
  if (['42501', '22023', '23505', 'P0002'].includes(code) && error.message) return error.message;
  return 'That did not go through. Nothing was changed — try again.';
}

const VETTING: Record<string, string> = {
  approved: 'Approved member',
  pending: 'Applicant',
  unvetted: 'Not yet vetted',
  rejected: 'Not admitted',
  waitlisted: 'Waitlisted',
};

export function vettingLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  return VETTING[status] ?? status;
}

/** Row shape of staff_search_members() (migration 131). */
export interface MemberSearchRow {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  vetting_status: string | null;
  is_staff: boolean;
  staff_role: string | null;
  created_at: string;
  is_deleted: boolean;
  suspended: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  reports_pending: number | string;
  reports_total: number | string;
}

export function displayNameOf(row: { display_name: string | null; username: string | null }): string {
  const d = row.display_name?.trim();
  if (d) return d;
  return row.username ? `@${row.username}` : 'Unnamed member';
}
