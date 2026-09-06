/**
 * Where a post lands, and the row that gets written.
 *
 * A post always lands on the author's profile. Communities are approved
 * special accounts now — they do not own a separate post folder. Asking
 * "where does this go?" was the old model, and it is what made posting
 * from her own profile feel broken.
 *
 * `posted_as_community` is forced false for the same reason the last
 * client still had: the INSERT policy from 073 permits that flag only
 * when an EXISTS finds the author as an admin of `posts.community_id`.
 * With a null community that EXISTS can never match, so the row is
 * refused as a bare 42501.
 */

export type PostDestination = { kind: 'profile' };

export type RoxyLinkSelection = {
  linkType: string;
  entityId: string;
  communityId?: string | null;
};

export type PostPayloadInput = {
  authorId: string;
  destination?: PostDestination;
  content: string;
  postType: string;
  postedAsCommunity?: boolean;
  roxyLink?: RoxyLinkSelection | null;
};

/**
 * Every route param is ignored. expo-router still hands back `communityId`
 * from old links; treating that as a destination would put the post back
 * inside a community folder we have retired.
 */
export function postDestination(_communityId?: string | null): PostDestination {
  return { kind: 'profile' };
}

export function destinationLabel(
  _destination?: PostDestination,
  _communityName?: string | null,
): string {
  return 'your profile';
}

export function buildPostPayload(input: PostPayloadInput): Record<string, unknown> {
  const { authorId, content, postType, roxyLink } = input;

  const payload: Record<string, unknown> = {
    author_id: authorId,
    community_id: null,
    content: content.trim(),
    post_type: postType,
    posted_as_community: false,
  };

  if (roxyLink) {
    payload.link_type = roxyLink.linkType;
    payload.link_entity_id = roxyLink.entityId;
    payload.link_community_id = roxyLink.communityId ?? null;
  }

  return payload;
}
