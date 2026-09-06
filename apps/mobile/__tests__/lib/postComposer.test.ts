import {
  postDestination,
  destinationLabel,
  buildPostPayload,
} from '../../lib/postComposer';

describe('postDestination', () => {
  it('is always her profile, even when an old community param is still on the URL', () => {
    expect(postDestination('c1')).toEqual({ kind: 'profile' });
    expect(postDestination(undefined)).toEqual({ kind: 'profile' });
    expect(postDestination(null)).toEqual({ kind: 'profile' });
    expect(postDestination('')).toEqual({ kind: 'profile' });
  });
});

describe('destinationLabel', () => {
  it('always says the post is going to her profile', () => {
    expect(destinationLabel({ kind: 'profile' }, 'WLW Hikers')).toBe('your profile');
  });
});

describe('buildPostPayload', () => {
  const base = { authorId: 'u1', content: '  hello  ', postType: 'standard' as const };

  it('writes a profile wall row — null community, never a community voice', () => {
    const payload = buildPostPayload({
      ...base,
      destination: { kind: 'profile' },
      postedAsCommunity: true,
    });
    expect(payload.community_id).toBeNull();
    expect(payload.author_id).toBe('u1');
    expect(payload.content).toBe('hello');
    expect(payload.posted_as_community).toBe(false);
  });

  it('ignores a leftover community destination from an old caller', () => {
    const payload = buildPostPayload({
      ...base,
      destination: { kind: 'community', communityId: 'c1' } as never,
      postedAsCommunity: true,
    });
    expect(payload.community_id).toBeNull();
    expect(payload.posted_as_community).toBe(false);
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
