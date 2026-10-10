/**
 * One answer to "is she a member yet?" (G-21).
 *
 * `useMembership` used to default a missing profile to 'pending' while
 * `resolveAccountKind` defaulted it to 'member', so during the profile fetch
 * the nav briefly rendered member tabs for an applicant and gated components
 * disagreed with each other. Both now read this.
 *
 * It mirrors the server exactly: `is_approved_member()` (migration 130) is
 * `vetting_status = 'approved' AND deleted_at IS NULL`. 'unvetted' no longer
 * exists — the pre-gate accounts were grandfathered to 'approved' — so it is
 * not a member state here either; a stale row that still says it fails closed.
 */

export type MembershipState = 'loading' | 'member' | 'pending' | 'rejected' | 'deleted';

export type MembershipProfile = {
  vetting_status?: string | null;
  deleted_at?: string | null;
} | null | undefined;

export function membershipState(profile: MembershipProfile): MembershipState {
  if (!profile) return 'loading';
  if (profile.deleted_at) return 'deleted';
  switch (profile.vetting_status) {
    case 'approved':
      return 'member';
    case 'rejected':
      return 'rejected';
    default:
      // 'pending', a legacy 'unvetted', or anything unknown: not a member.
      return 'pending';
  }
}

export function isMemberState(state: MembershipState): boolean {
  return state === 'member';
}
