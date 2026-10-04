import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ReelsFeed } from '../../components/feed/ReelsFeed';
import type { ReelRow } from '../../lib/reels';

/**
 * For You is the Feed tab's front door (`scope="announcements"`), and the
 * composer offers text cards, photos and video. On production most profile
 * walls are text and photos (26 text / 5 photo / 8 video on 2026-10-04), so a
 * For You that only plays video shows a newcomer a handful of stock clips and
 * hides almost everything the community has actually written.
 *
 * The Supabase mock here is a tiny query engine rather than a canned answer:
 * `.eq()` and `.in()` really filter the rows, so the assertion is about what
 * reaches the list, whichever filters the code under test chooses to apply.
 */
jest.setTimeout(15000);

type Row = Record<string, unknown> & { id: string; post_type: string };

const WALL: Row[] = [
  {
    id: 'fy-text', author_id: 'u1', community_id: null, content: 'first pride without hiding',
    post_type: 'standard', comment_count: 2, like_count: 9, feed_score: 70,
    video_url: null, video_thumbnail_url: null, created_at: '2026-09-20T10:00:00Z',
    profiles: { display_name: 'Mara', avatar_url: null }, communities: null,
  },
  {
    id: 'fy-video', author_id: 'u2', community_id: null, content: 'a clip',
    post_type: 'video', comment_count: 0, like_count: 3, feed_score: 60,
    video_url: 'https://cdn.example.test/a.m3u8', video_thumbnail_url: 'u2/a/thumb.jpg',
    created_at: '2026-09-19T10:00:00Z',
    profiles: { display_name: 'Ivy', avatar_url: null }, communities: null,
  },
  {
    id: 'fy-photo', author_id: 'u3', community_id: null, content: 'sunday market',
    post_type: 'photo', comment_count: 0, like_count: 1, feed_score: 50,
    video_url: null, video_thumbnail_url: 'u3/b/thumb.jpg', created_at: '2026-09-18T10:00:00Z',
    profiles: { display_name: 'Noor', avatar_url: null }, communities: null,
  },
];

jest.mock('@shopify/flash-list', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const captured: Record<string, unknown>[] = [];
  const FlashList = ReactLocal.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    captured.push(props);
    ReactLocal.useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn() }));
    return ReactLocal.createElement(View, { testID: 'flash-list' });
  });
  return { FlashList, __captured: captured };
});

jest.mock('../../components/feed/ReelCell', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    ReelCell: (props: Record<string, unknown>) =>
      ReactLocal.createElement(View, { testID: 'reel-cell', ...props }),
  };
});

jest.mock('../../lib/supabase', () => {
  const makeQuery = (): Record<string, unknown> => {
    const filters: ((r: Row) => boolean)[] = [];
    const q: Record<string, unknown> = {};
    q.select = jest.fn(() => q);
    q.in = jest.fn((col: string, vals: unknown[]) => {
      filters.push((r) => vals.includes(r[col]));
      return q;
    });
    q.eq = jest.fn((col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return q;
    });
    q.is = jest.fn((col: string, val: unknown) => {
      filters.push((r) => (r[col] ?? null) === val);
      return q;
    });
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({
        data: mockWall().filter((r) => filters.every((f) => f(r))),
        error: null,
      }).then(resolve, reject);
    return q;
  };
  return {
    supabase: {
      from: jest.fn(() => makeQuery()),
      rpc: jest.fn(() =>
        Promise.resolve({
          data: mockWall().map((r, i) => ({
            post_id: r.id, community_id: null, rank: 100 - i, created_at: r.created_at,
          })),
          error: null,
        }),
      ),
    },
    callEdgeFunction: jest.fn(() => Promise.resolve({ data: { ok: true }, error: null })),
  };
});

// Read lazily by the mock factory above (jest hoists factories over `const`).
// A test may swap the wall for one case; `beforeEach` puts it back.
const mockWallState: { rows: Row[] | null } = { rows: null };
function mockWall(): Row[] {
  return mockWallState.rows ?? WALL;
}
beforeEach(() => {
  mockWallState.rows = null;
});

jest.mock('../../store/safetyStore', () => {
  const state = { blockUser: jest.fn(() => Promise.resolve()) };
  const useSafetyStore = (selector: (s: typeof state) => unknown): unknown => selector(state);
  useSafetyStore.getState = (): typeof state => state;
  return { useSafetyStore };
});

jest.mock('../../store/feedStore', () => {
  const state = {
    likedPostIds: new Set<string>(),
    savedPostIds: new Set<string>(),
    likeCountDeltas: {} as Record<string, number>,
    seenPostIds: new Set<string>(),
    toggleLike: jest.fn(),
    toggleSave: jest.fn(),
    markSeen: jest.fn(),
  };
  const useFeedStore = (selector: (s: typeof state) => unknown): unknown => selector(state);
  useFeedStore.getState = (): typeof state => state;
  return { useFeedStore };
});

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
jest.mock('../../components/feed/CommentSheet', () => ({ CommentSheet: () => null }));

function latestData(): ReelRow[] {
  const { __captured } = jest.requireMock('@shopify/flash-list') as {
    __captured: { data: ReelRow[] }[];
  };
  return __captured[__captured.length - 1]?.data ?? [];
}

describe('For You (Feed tab, scope="announcements")', () => {
  it('says "posts", not "videos", when For You is empty', async () => {
    // The feed carries every post type, so "No videos yet" over an empty wall
    // would tell her the wrong thing about what is missing.
    mockWallState.rows = [];
    const view = render(<ReelsFeed scope="announcements" />);
    fireEvent(view.getByTestId('reels-feed'), 'layout', {
      nativeEvent: { layout: { height: 800, width: 400 } },
    });

    await waitFor(() => expect(view.getByTestId('reels-feed-empty')).toBeTruthy());
    expect(view.queryByText(/no videos/i)).toBeNull();
    expect(view.getByText('Nothing here yet')).toBeTruthy();
  });

  it('shows text and photo posts from profile walls, not only video', async () => {
    const view = render(<ReelsFeed scope="announcements" />);
    fireEvent(view.getByTestId('reels-feed'), 'layout', {
      nativeEvent: { layout: { height: 800, width: 400 } },
    });

    await waitFor(() => expect(latestData().length).toBeGreaterThan(0));
    expect(latestData().map((r) => r.id)).toEqual(['fy-text', 'fy-video', 'fy-photo']);
  });
});
