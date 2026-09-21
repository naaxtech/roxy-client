/**
 * Who the Following segment reads posts from.
 *
 * Her own id belongs in this list and was missing from it. The Feed tab passed
 * `followingIds` straight through, so the Following query filtered on everyone
 * except the one author whose posts she had just written. Combined with
 * publish landing her on a profile tab that only shows media, the whole act of
 * posting read as a no-op: nothing on the screen she landed on, nothing in the
 * feed she checked next.
 *
 * Deduped because `in()` with a repeated id is a wasted probe, and because a
 * stray self-follow row must not change the result.
 */
export function followingAuthorIds(
  followingIds: Iterable<string>,
  viewerId: string | null | undefined,
): string[] {
  const ids = new Set(followingIds);
  if (viewerId) ids.add(viewerId);
  return Array.from(ids);
}
