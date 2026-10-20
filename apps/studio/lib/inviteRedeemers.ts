import type { AccountKind } from '@/lib/accountKind';

/*
 * UNUSED since gate wave 3 (kept on purpose, per the no-deletion rule).
 * Origin: 33e3460 (2026-09-07), grouping invite_code_redeemers() rows per code
 * for /invites when a code could admit several people. Migration 134 made every
 * code single use and /invites now reads invite_code_ledger() via
 * lib/inviteLedger.ts. Use again only if a multi-redemption view (e.g. a
 * historical report of pre-134 shared codes) is ever needed.
 */

export type InviteRedeemer = {
  codeId: string;
  userId: string;
  displayName: string;
  username: string | null;
  accountKind: AccountKind;
  usedAt: string;
};

export function groupRedeemersByCode(
  redeemers: InviteRedeemer[],
): Map<string, InviteRedeemer[]> {
  const grouped = new Map<string, InviteRedeemer[]>();
  for (const row of redeemers) {
    const list = grouped.get(row.codeId) ?? [];
    list.push(row);
    grouped.set(row.codeId, list);
  }
  return grouped;
}
