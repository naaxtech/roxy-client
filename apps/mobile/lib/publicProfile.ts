/**
 * Profile columns another member may read (migration 130, PRO-01).
 *
 * Mirrors the column-level GRANT SELECT on public.profiles. Anything not in
 * this list (location, last_seen_at, age preferences, notification
 * preferences, vetting/admission state, Stripe id, shipping address, consent
 * flags, access tier, onboarding state) is readable only by its owner,
 * through the `my_profile` view.
 *
 * Selecting a column outside this list fails the whole request with
 * "permission denied for table profiles" — keep reads of another member's
 * row to these fields.
 */
export const PUBLIC_PROFILE_COLUMNS = [
  'id',
  'username',
  'display_name',
  'bio',
  'avatar_url',
  'pronouns',
  'identity_labels',
  'interests',
  'is_dating_mode',
  'dating_looking_for',
  'is_verified',
  'gov_verified',
  'is_active',
  'is_ghost',
  'gamification_points',
  'badge_ids',
  'custom_tags',
  'staff_tag',
  'staff_tag_set_at',
  'is_staff',
  'staff_role',
  'is_community_owner',
  'official_community_id',
  'created_at',
] as const;

export type PublicProfileColumn = (typeof PUBLIC_PROFILE_COLUMNS)[number];

export const PUBLIC_PROFILE_FIELDS = PUBLIC_PROFILE_COLUMNS.join(', ');
