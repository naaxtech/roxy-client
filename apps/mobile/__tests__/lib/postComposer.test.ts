import {
  postDestination,
  destinationLabel,
  buildPostPayload,
} from '../../lib/postComposer';

/**
 * A post lands on a profile now, not in a community.
 *
 * Every profile is a TikTok-style wall — a woman's or a community's — and all of
 * her posts appear there. Posting into a community is no longer the only way to
 * post, and the create sheet no longer refuses her until she has joined one.
 *
 * The schema was always ready for this: `posts.community_id` is nullable,
 * `can_read_community_content(NULL)` is true for an approved member, and
 * `posts_select` has carried an explicit `community_id IS NULL` arm since 076.
 * The gate was entirely in the client.
 *
 * The one thing that is NOT free is `posted_as_community`. The INSERT policy
 * (073) allows it only when an EXISTS finds the author as an admin of
 * `posts.community_id` — and with a null community that EXISTS can never match,
 * so a profile post carrying `posted_as_community: true` is refused by RLS with
 * a 42501 that reads, unhelpfully, as a permissions bug. Forcing it false for a
 * profile post is what the last two tests here are for.
 */

describe('postDestination', () => {
  it('is the community when one was given', () => {
    expect(postDestination('c1')).toEqual({ kind: 'community', communityId: 'c1' });
  });

  it('is her profile when none was', () => {
    expect(postDestination(undefined)).toEqual({ kind: 'profile' });
    expect(postDestination(null)).toEqual({ kind: 'profile' });
  });

  it('treats an empty string as no community rather than as a community named ""', () => {
    // expo-router hands back '' for a param that was not supplied, and an empty
    // string is truthy-adjacent enough to have caused this exact class of bug
    // before: the insert would carry community_id: '' and fail on the uuid cast.
    expect(postDestination('')).toEqual({ kind: 'profile' });
  });
});

describe('destinationLabel', () => {
  it('names the community when posting to one', () => {
    expect(destinationLabel({ kind: 'community', communityId: 'c1' }, 'WLW Hikers'))
      .toBe('WLW Hikers');
  });

  it('falls back to a truthful label when the community name has not loaded', () => {
    expect(destinationLabel({ kind: 'community', communityId: 'c1' }, null))
      .toBe('this community');
  });

  it('says the post is going to her profile', () => {
    expect(destinationLabel({ kind: 'profile' }, null)).toBe('your profile');
  });
});

describe('buildPostPayload', () => {
  const base = { authorId: 'u1', content: '  hello  ', postType: 'standard' as const };

  it('carries a null community for a profile post', () => {
    const payload = buildPostPayload({ ...base, destination: { kind: 'profile' } });
    expect(payload.community_id).toBeNull();
    expect(payload.author_id).toBe('u1');
    expect(payload.content).toBe('hello');
  });

  it('carries the community id when posting to one', () => {
    const payload = buildPostPayload({
      ...base,
      destination: { kind: 'community', communityId: 'c1' },
    });
    expect(payload.community_id).toBe('c1');
  });

  it('refuses to mark a profile post as posted by a community', () => {
    // Not cosmetic. With community_id null the INSERT policy's admin EXISTS
    // cannot match, so this exact payload is rejected by RLS.
    const payload = buildPostPayload({
      ...base,
      destination: { kind: 'profile' },
      postedAsCommunity: true,
    });
    expect(payload.posted_as_community).toBe(false);
  });

  it('keeps the community-voice flag when it is a community post', () => {
    const payload = buildPostPayload({
      ...base,
      destination: { kind: 'community', communityId: 'c1' },
      postedAsCommunity: true,
    });
    expect(payload.posted_as_community).toBe(true);
  });

  it('attaches a roxy link only when there is one', () => {
    const withLink = buildPostPayload({
      ...base,
      postType: 'roxy_link',
      destination: { kind: 'profile' },
      roxyLink: { linkType: 'game', entityId: 'g1', communityId: 'c9' },
    });
    expect(withLink.link_type).toBe('game');
    expect(withLink.link_entity_id).toBe('g1');
    expect(withLink.link_community_id).toBe('c9');

    const withoutLink = buildPostPayload({ ...base, destination: { kind: 'profile' } });
    expect(withoutLink).not.toHaveProperty('link_type');
  });
});
