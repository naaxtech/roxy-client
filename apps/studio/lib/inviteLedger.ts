/**
 * Invite-code accountability (Nicole, 2026-10-11).
 *
 * Every code is single use and tied to one woman. Studio shows, per code: who
 * minted it, who used it (name + username), when, where her membership stands
 * now and when she last signed in. The rows come from
 * public.invite_code_ledger() (migration 134), which decides visibility:
 * staff see every code, a community admin sees the codes she minted. Last
 * sign-in is exact for staff and to the day for admins (the RPC truncates it).
 *
 * The database is the authority on the cap and on single use (134's triggers);
 * nothing here enforces them. openCodeCount() only mirrors the cap's count so
 * the form can say "7 of 10" before she hits it.
 */

export type LedgerKind = 'invite' | 'review' | 'member';

/** One row of public.invite_code_ledger(). */
export interface LedgerRow {
  code_id: string;
  code: string;
  community_id: string | null;
  community_name: string | null;
  label: string | null;
  kind: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  locked_at: string | null;
  minted_by: string | null;
  minter_name: string | null;
  minter_username: string | null;
  redeemed_by: string | null;
  redeemer_name: string | null;
  redeemer_username: string | null;
  redeemed_at: string | null;
  redeemer_status: string | null;
  redeemer_last_sign_in: string | null;
}

export interface LedgerPerson {
  id: string | null;
  displayName: string | null;
  username: string | null;
}

export interface LedgerRedeemer extends LedgerPerson {
  redeemedAt: string | null;
  /** approved | pending | rejected | suspended | deleted | account_deleted */
  status: string | null;
  lastSignInAt: string | null;
}

export interface LedgerCode {
  id: string;
  code: string;
  communityId: string | null;
  communityName: string;
  label: string | null;
  kind: LedgerKind;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lockedAt: string | null;
  minter: LedgerPerson | null;
  redeemer: LedgerRedeemer | null;
  used: boolean;
}

export type LedgerCodeState = 'active' | 'locked' | 'revoked' | 'expired' | 'used';

/** The default cap on an admin's unused codes (gate_settings.admin_open_code_cap). */
export const ADMIN_OPEN_CODE_CAP = 10;

function asKind(kind: string): LedgerKind {
  return kind === 'review' || kind === 'member' ? kind : 'invite';
}

export function mapLedgerRow(row: LedgerRow): LedgerCode {
  // A code is used once she redeemed it. After her account is erased the FK
  // clears redeemed_by, but redeemed_at and the 'account_deleted' status stay,
  // so the code still reads as used and can never be handed out again.
  const used = row.redeemed_by !== null || row.redeemed_at !== null || row.redeemer_status !== null;
  return {
    id: row.code_id,
    code: row.code,
    communityId: row.community_id,
    communityName: row.community_name ?? 'Unnamed community',
    label: row.label,
    kind: asKind(row.kind),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lockedAt: row.locked_at,
    minter: row.minted_by
      ? { id: row.minted_by, displayName: row.minter_name, username: row.minter_username }
      : null,
    redeemer: used
      ? {
          id: row.redeemed_by,
          displayName: row.redeemer_name,
          username: row.redeemer_username,
          redeemedAt: row.redeemed_at,
          status: row.redeemer_status,
          lastSignInAt: row.redeemer_last_sign_in,
        }
      : null,
    used,
  };
}

export function codeState(item: LedgerCode, now: number): LedgerCodeState {
  if (item.revokedAt) return 'revoked';
  if (item.used) return 'used';
  if (item.lockedAt) return 'locked';
  if (item.expiresAt && Date.parse(item.expiresAt) <= now) return 'expired';
  return 'active';
}

/** Her unused, still-working invite codes: what the 134 cap counts. */
export function openCodeCount(codes: LedgerCode[], userId: string, now: number): number {
  return codes.filter(
    (c) => c.kind === 'invite' && c.minter?.id === userId && codeState(c, now) === 'active',
  ).length;
}

const STATUS_LABEL: Record<string, string> = {
  approved: 'Member',
  pending: 'Application in review',
  rejected: 'Not approved',
  suspended: 'Suspended',
  deleted: 'Deleted her account',
  account_deleted: 'Account erased',
};

export function memberStatusLabel(status: string | null): string {
  if (status === null) return '—';
  return STATUS_LABEL[status] ?? status;
}
