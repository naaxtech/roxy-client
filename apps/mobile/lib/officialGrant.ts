/**
 * Official community is a Roxy grant on a person, not a folder posts live in.
 *
 * `profiles.official_community_id` is the source of truth. The older
 * `is_community_owner` flag still opens chat; Join and Discover placement
 * read the FK so a tag without a linked community cannot pretend to be joinable.
 */

export function isOfficialAccount(
  profile: { official_community_id?: string | null } | null | undefined,
): boolean {
  return typeof profile?.official_community_id === 'string'
    && profile.official_community_id.length > 0;
}

export function officialCommunityIdsFromProfiles(
  rows: readonly { official_community_id?: string | null }[],
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.official_community_id) ids.add(row.official_community_id);
  }
  return [...ids];
}

/** Official communities first, then everyone else, original order kept inside each group. */
export function officialFirst<T extends { id: string }>(
  rows: readonly T[],
  officialIds: ReadonlySet<string>,
): T[] {
  if (officialIds.size === 0) return [...rows];
  const official: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    (officialIds.has(row.id) ? official : rest).push(row);
  }
  return official.concat(rest);
}
