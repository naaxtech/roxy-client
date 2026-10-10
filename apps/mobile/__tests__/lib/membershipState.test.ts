import { isMemberState, membershipState } from '../../lib/membershipState';
import { resolveAccountKind } from '../../lib/features';

/**
 * G-21: useMembership and resolveAccountKind used to disagree about a missing
 * profile ('pending' vs 'member'), so the nav flashed member tabs at an
 * applicant during every profile fetch. Both now fail closed, and a member is
 * exactly what the server's is_approved_member() says: approved, not deleted.
 */
describe('membershipState', () => {
  it.each([
    [null, 'loading'],
    [undefined, 'loading'],
    [{ vetting_status: 'approved' }, 'member'],
    [{ vetting_status: 'pending' }, 'pending'],
    [{ vetting_status: 'rejected' }, 'rejected'],
    [{ vetting_status: 'unvetted' }, 'pending'],
    [{ vetting_status: null }, 'pending'],
    [{ vetting_status: 'approved', deleted_at: '2026-10-01T00:00:00Z' }, 'deleted'],
  ])('%j -> %s', (profile, expected) => {
    expect(membershipState(profile as never)).toBe(expected);
  });

  it('only member is a member', () => {
    expect(isMemberState('member')).toBe(true);
    for (const s of ['loading', 'pending', 'rejected', 'deleted'] as const) {
      expect(isMemberState(s)).toBe(false);
    }
  });

  it.each([
    [null],
    [{ vetting_status: 'pending' }],
    [{ vetting_status: 'rejected' }],
    [{ vetting_status: 'unvetted' }],
    [{ vetting_status: 'approved' }],
  ])('agrees with resolveAccountKind for %j', (profile) => {
    const memberByState = isMemberState(membershipState(profile as never));
    const memberByKind = resolveAccountKind(profile as never) !== 'pending';
    expect(memberByKind).toBe(memberByState);
  });
});
