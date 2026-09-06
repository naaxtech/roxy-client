import type { AccountKind } from '@/lib/accountKind';

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
