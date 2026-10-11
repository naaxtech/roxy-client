import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ReelsFeed } from '../../components/feed/ReelsFeed';
import type { ReelRow } from '../../lib/reels';
import { dailyPromptFor } from '../../lib/dailyPrompt';

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
      // Answers like `feed_rank_page` (133): rows after the cursor, in rank
      // order, each carrying the clock the first page was ranked at.
      rpc: jest.fn((fn: string, args: Record<string, unknown>) => {
        mockRpcCalls.push({ fn, args });
        const ranked = mockWall().map((r, i) => ({
          post_id: r.id, community_id: null, rank: 100 - i, created_at: r.created_at,
          as_of: '2026-10-11T00:00:00Z',
        }));
        const after = args.p_cursor_id == null
          ? ranked
          : ranked.slice(ranked.findIndex((r) => r.post_id === args.p_cursor_id) + 1);
        return Promise.resolve({ data: after.slice(0, Number(args.p_limit)), error: null });
      }),
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
const mockRpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
beforeEach(() => {
  mockWallState.rows = null;
  mockRpcCalls.length = 0;
  (jest.requireMock('../../store/safetyStore') as {
    useSafetyStore: { getState: () => { mutedUserIds: string[] } };
  }).useSafetyStore.getState().mutedUserIds = [];
});

jest.mock('../../store/safetyStore', () => {
  const state = {
    blockUser: jest.fn(() => Promise.resolve()),
    muteUser: jest.fn(() => Promise.resolve()),
    mutedUserIds: [] as string[],
  };
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
    hiddenPostIds: new Set<string>(),
    toggleLike: jest.fn(),
    likePost: jest.fn(),
    toggleSave: jest.fn(),
    markSeen: jest.fn(),
    hidePost: jest.fn(() => Promise.resolve(true)),
  };
  const useFeedStore = (selector: (s: typeof state) => unknown): unknown => selector(state);
  useFeedStore.getState = (): typeof state => state;
  return { useFeedStore };
});

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
jest.mock('../../components/feed/CommentSheet', () => ({ CommentSheet: () => null }));
jest.mock('../../hooks/usePlaybackAllowed', () => ({ usePlaybackAllowed: () => true }));

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

  it('ranks through feed_rank_page from a fresh clock, not the legacy RPC', async () => {
    const view = render(<ReelsFeed scope="announcements" />);
    fireEvent(view.getByTestId('reels-feed'), 'layout', {
      nativeEvent: { layout: { height: 800, width: 400 } },
    });

    await waitFor(() => expect(latestData().length).toBeGreaterThan(0));
    expect(mockRpcCalls[0]).toMatchObject({
      fn: 'feed_rank_page',
      args: { p_as_of: null, p_cursor_rank: null, p_cursor_id: null },
    });
  });

  it('pages on the keyset (rank, created_at, id) at the first page\'s clock (FEED-02)', async () => {
    // 51 posts: one more than the RPC's page, so there is a second page.
    mockWallState.rows = Array.from({ length: 51 }, (_, i) => ({
      ...WALL[0],
      id: `fy-${String(i).padStart(2, '0')}`,
      created_at: '2026-09-20T10:00:00Z',
    }));
    const view = render(<ReelsFeed scope="announcements" />);
    fireEvent(view.getByTestId('reels-feed'), 'layout', {
      nativeEvent: { layout: { height: 800, width: 400 } },
    });
    await waitFor(() => expect(latestData()).toHaveLength(50));

    const { __captured } = jest.requireMock('@shopify/flash-list') as {
      __captured: { onEndReached: () => void }[];
    };
    await act(async () => { __captured[__captured.length - 1].onEndReached(); });
    await waitFor(() => expect(latestData()).toHaveLength(51));

    expect(mockRpcCalls[1]).toMatchObject({
      fn: 'feed_rank_page',
      args: {
        p_as_of: '2026-10-11T00:00:00Z',
        p_cursor_rank: 51,
        p_cursor_created_at: '2026-09-20T10:00:00Z',
        p_cursor_id: 'fy-49',
      },
    });
  });

  it('drops a muted author from For You', async () => {
    (jest.requireMock('../../store/safetyStore') as {
      useSafetyStore: { getState: () => { mutedUserIds: string[] } };
    }).useSafetyStore.getState().mutedUserIds = ['u2'];
    const view = render(<ReelsFeed scope="announcements" />);
    fireEvent(view.getByTestId('reels-feed'), 'layout', {
      nativeEvent: { layout: { height: 800, width: 400 } },
    });

    await waitFor(() => expect(latestData().length).toBeGreaterThan(0));
    expect(latestData().map((r) => r.id)).toEqual(['fy-text', 'fy-photo']);
  });
});

describe('Question of the day page (audit #4)', () => {
  const PROMPT = dailyPromptFor(new Date(2026, 9, 11, 12));

  type PagerList = {
    data: { id: string }[];
    getItemType: (item: unknown, index: number) => string | number;
    renderItem: (info: { item: unknown; index: number }) => React.ReactElement;
    onViewableItemsChanged: (info: { viewableItems: { index: number | null }[] }) => void;
  };
  function latestList(): PagerList {
    const { __captured } = jest.requireMock('@shopify/flash-list') as { __captured: PagerList[] };
    return __captured[__captured.length - 1];
  }
  async function mount(props: Record<string, unknown>) {
    const view = render(<ReelsFeed {...props} />);
    fireEvent(view.getByTestId('reels-feed'), 'layout', {
      nativeEvent: { layout: { height: 800, width: 400 } },
    });
    await waitFor(() => expect(latestData().length).toBeGreaterThan(0));
    return view;
  }

  it('is the third page of For You, in its own recycling pool', async () => {
    await mount({ scope: 'announcements', dailyPrompt: PROMPT });

    expect(latestData().map((r) => r.id)).toEqual(['fy-text', 'fy-video', PROMPT.id, 'fy-photo']);
    const list = latestList();
    expect(list.getItemType(list.data[2], 2)).toBe('daily_prompt');
    expect(list.getItemType(list.data[0], 0)).toBe('standard');
  });

  it('renders the question card, not a post cell', async () => {
    await mount({ scope: 'announcements', dailyPrompt: PROMPT });
    const list = latestList();
    const cell = list.renderItem({ item: list.data[2], index: 2 });
    const page = render(cell);

    expect(page.getByTestId('daily-prompt-cell')).toBeTruthy();
    expect(page.getByText(PROMPT.question)).toBeTruthy();
  });

  it('is never recorded as a seen post', async () => {
    await mount({ scope: 'announcements', dailyPrompt: PROMPT });
    const markSeen = (jest.requireMock('../../store/feedStore') as {
      useFeedStore: { getState: () => { markSeen: jest.Mock } };
    }).useFeedStore.getState().markSeen;
    markSeen.mockClear();

    await act(async () => { latestList().onViewableItemsChanged({ viewableItems: [{ index: 2 }] }); });
    await act(async () => { latestList().onViewableItemsChanged({ viewableItems: [{ index: 3 }] }); });

    expect(markSeen).not.toHaveBeenCalledWith(PROMPT.id);
    expect(markSeen).toHaveBeenCalledWith('fy-photo');
  });

  it('stays out of every other scope, and out of For You once answered (null)', async () => {
    await mount({ scope: 'announcements', dailyPrompt: null });
    expect(latestData().map((r) => r.id)).not.toContain(PROMPT.id);

    await mount({ scope: 'following', authorIds: ['u1', 'u2', 'u3'], dailyPrompt: PROMPT });
    expect(latestData().map((r) => r.id)).not.toContain(PROMPT.id);
  });
});
