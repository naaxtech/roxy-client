/**
 * Where a post lands, and the row that gets written.
 *
 * Every profile is a wall now — a woman's or a community's — and all of her
 * posts appear on hers. Posting into a community is one option rather than the
 * only one, so the create sheet no longer refuses her until she has joined
 * something. The schema was always ready: `posts.community_id` is nullable,
 * `can_read_community_content(NULL)` is true for an approved member, and
 * `posts_select` has had an explicit `community_id IS NULL` arm since migration
 * 076. The whole gate lived in the client.
 *
 * This module exists so the destination is decided in one place and can be
 * tested without a database, because one of the rules it enforces is invisible
 * until RLS refuses the write — see `posted_as_community` below.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · profile markup 456–655 · 2026-09-01
 */

export type PostDestination =
  | { kind: 'profile' }
  | { kind: 'community'; communityId: string };

export type RoxyLinkSelection = {
  linkType: string;
  entityId: string;
  communityId?: string | null;
};

export type PostPayloadInput = {
  authorId: string;
  destination: PostDestination;
  content: string;
  postType: string;
  postedAsCommunity?: boolean;
  roxyLink?: RoxyLinkSelection | null;
};

/**
 * An absent route param is a profile post.
 *
 * The empty-string case is deliberate rather than defensive: expo-router hands
 * back `''` for a param that was not supplied, and `''` is just truthy enough
 * in the wrong `if` to reach the insert as `community_id: ''`, which fails on
 * the uuid cast rather than on anything a reader would recognise.
 */
export function postDestination(communityId?: string | null): PostDestination {
  if (!communityId || communityId.trim() === '') return { kind: 'profile' };
  return { kind: 'community', communityId };
}

export function destinationLabel(
  destination: PostDestination,
  communityName: string | null
): string {
  if (destination.kind === 'profile') return 'your profile';
  return communityName ?? 'this community';
}

export function buildPostPayload(input: PostPayloadInput): Record<string, unknown> {
  const { authorId, destination, content, postType, postedAsCommunity, roxyLink } = input;

  const payload: Record<string, unknown> = {
    author_id: authorId,
    community_id: destination.kind === 'community' ? destination.communityId : null,
    content: content.trim(),
    post_type: postType,
    // Only a community post can be published in a community's voice, and this
    // is not merely tidiness: the INSERT policy from 073 permits
    // `posted_as_community` only when an EXISTS finds the author as an admin of
    // `posts.community_id`. With a null community that EXISTS can never match,
    // so the row is refused — and it surfaces as a bare 42501, which reads like
    // a permissions bug rather than a payload the client should not have built.
    posted_as_community: destination.kind === 'community' && postedAsCommunity === true,
  };

  if (roxyLink) {
    payload.link_type = roxyLink.linkType;
    payload.link_entity_id = roxyLink.entityId;
    payload.link_community_id = roxyLink.communityId ?? null;
  }

  return payload;
}
