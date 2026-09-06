// linkedEntityPath's 'game' branch queries Supabase. Mock the chain so the test
// never reaches the network — inline factory per anti-pattern 2, since a
// jest.mock factory may not close over anything declared outside it.
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: null })),
        })),
      })),
    })),
  },
}));

import { contentDetailPath, linkedEntityPath } from '../lib/contentNavigation';
import type { Post } from '../types';

function makeLinkPost(overrides: Partial<Post>): Post {
  return { id: 'post-1', link_type: null, link_entity_id: null, ...overrides } as Post;
}

describe('contentDetailPath', () => {
  it('routes video to community video player', () => {
    expect(contentDetailPath('abc', 'video')).toBe('/community/video/abc');
  });

  it('routes other types to community post detail', () => {
    expect(contentDetailPath('abc', 'photo')).toBe('/community/post/abc');
    expect(contentDetailPath('abc', 'standard')).toBe('/community/post/abc');
  });
});

describe('linkedEntityPath', () => {
  // Regression: this returned `/(tabs)/connect/community-room-session`, pushing
  // the live call stage INTO the Connect stack. Leaving the call then stranded a
  // dead room screen as that stack's top route, so tapping Connect re-entered a
  // call that had already been torn down. Every other caller in the app pushes
  // the root route; this single path disagreed with them.
  it('routes a room link to the root call route, never into the Connect stack', async () => {
    const path = await linkedEntityPath(
      makeLinkPost({ link_type: 'room', link_entity_id: 'room-abc' }),
    );

    expect(path).toBe('/community-room-session?room_id=room-abc');
    expect(path).not.toContain('(tabs)');
  });

  it('returns null when a room link carries no entity id', async () => {
    const path = await linkedEntityPath(
      makeLinkPost({ link_type: 'room', link_entity_id: null }),
    );
    expect(path).toBeNull();
  });

  it('sends event links to the root event route', async () => {
    const path = await linkedEntityPath(
      makeLinkPost({ link_type: 'event', link_entity_id: 'evt-9' }),
    );
    expect(path).toBe('/event/evt-9');
  });

  it('returns null for a game link that resolves to no row', async () => {
    const path = await linkedEntityPath(
      makeLinkPost({ link_type: 'game', link_entity_id: 'game-x' }),
    );
    expect(path).toBeNull();
  });

  it('returns null for a post with no link type', async () => {
    expect(await linkedEntityPath(makeLinkPost({}))).toBeNull();
  });
});
