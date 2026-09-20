import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';

/**
 * What the WLW Archive gates on.
 *
 * There is no `membership_status` column. Migration 070 already owns this
 * state machine as `profiles.vetting_status`, and 095_archive_core.sql's own
 * header is a comment about why a second copy of it was rejected: this
 * codebase has already shipped the "a status nothing reads" bug once —
 * `block_user` wrote `friendships.status = 'blocked'` and nothing checked it,
 * so the app told a woman she was protected when she was not. The Archive
 * reads the gate that exists.
 */
export type MembershipStatus = 'unvetted' | 'pending' | 'approved' | 'rejected';

export type Membership = {
  status: MembershipStatus;
  /**
   * Every RLS policy 096_archive_rls.sql puts on archive_entries /
   * archive_votes / archive_watchlist is `TO authenticated` with no
   * vetting_status check at all — deliberately. 079_restore_vetting_default
   * is the postmortem this answers: a new signup landed on
   * vetting_status = 'pending', every gate helper returned false, and she was
   * locked out of the entire app with no screen explaining why. Browsing (and
   * voting, and her own watchlist) is the door this feature keeps open for her
   * while she waits, so this is true for any authenticated profile — 'pending'
   * included, and RLS itself draws no line at 'rejected' either.
   */
  canBrowseArchive: boolean;
  /** Composed from the states it PERMITS — see isApprovedMember below. */
  canReview: boolean;
  canEdit: boolean;
};

/**
 * Mirrors `is_approved_member()` (072_invite_gate_enforcement.sql):
 * `vetting_status IN ('approved', 'unvetted')`.
 *
 * 'unvetted' is the grandfathered pre-gate population and MUST be included.
 * This codebase has twice shipped a bug where a third enum value fell through
 * a `!==`/elimination branch and was handled as its opposite — composing this
 * as "not pending" would be exactly that bug, and it would lock out every
 * account that existed before the gate shipped, which is precisely what
 * 072's own comment warns the naive predicate does.
 */
function isApprovedMember(status: MembershipStatus): boolean {
  return status === 'approved' || status === 'unvetted';
}

export function useMembership(): Membership {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);

  // No profile row yet — still loading, or genuinely signed out — fails
  // closed to 'pending' rather than to 'unvetted': she may browse once a
  // session exists, but never gets premature review/edit access before this
  // hook actually knows her real status. (profileStore is warmed by the root
  // layout's own effect, so in practice this only covers the brief window
  // before that fetch resolves.)
  const status: MembershipStatus = profile?.vetting_status ?? 'pending';

  return {
    status,
    canBrowseArchive: !!user,
    canReview: isApprovedMember(status),
    canEdit: isApprovedMember(status),
  };
}
