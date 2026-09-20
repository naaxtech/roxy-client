import { groupRedeemersByCode, type InviteRedeemer } from '@/lib/inviteRedeemers';

const PURR: InviteRedeemer = {
  codeId: 'code-1',
  userId: 'u-purr',
  displayName: 'The Purrfessional',
  username: 'purrfessional',
  accountKind: 'pending',
  usedAt: '2026-09-06T19:17:27.000Z',
};

const OTHER: InviteRedeemer = {
  codeId: 'code-2',
  userId: 'u-2',
  displayName: 'Ari',
  username: 'ari',
  accountKind: 'member',
  usedAt: '2026-09-01T00:00:00.000Z',
};

describe('groupRedeemersByCode', () => {
  it('puts each woman under the code she actually used', () => {
    const grouped = groupRedeemersByCode([PURR, OTHER]);
    expect(grouped.get('code-1')).toEqual([PURR]);
    expect(grouped.get('code-2')).toEqual([OTHER]);
    expect(grouped.get('unused')).toBeUndefined();
  });
});
