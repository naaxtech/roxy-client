import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ReelsFeed } from '../../components/feed/ReelsFeed';
import type { ReelRow } from '../../lib/reels';

/**
 * Jest's default is 5s per test, and the FIRST test in this file pays for module
 * init on top of its own work — React Native, reanimated, gesture-handler and
 * the whole ReelsFeed tree are loaded inside that budget, where every later test
 * gets them warm. The file takes ~10s in total on a shared CI runner, so the
 * opening test times out there while passing comfortably on a dev machine.
 *
 * Set for the file rather than on the one test that happened to be first,
 * because otherwise the failure simply moves the next time somebody reorders a
 * describe block. Kept well under a minute so a genuine hang still fails fast
 * rather than sitting in a queue.
 *
 * This surfaced only after CI moved to Node 22 — before that, this suite could
 * not run at all (`@supabase/realtime-js` throws at import without a global
 * WebSocket) and the timeout was hidden behind "Test suite failed to run".
 */
jest.setTimeout(15000);

const VIDEO_ID = 'r-video';
const PHOTO_ID = 'r-photo';

/** Records every prop set ReelsFeed hands the list, so the config is assertable. */
jest.mock('@shopify/flash-list', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const captured: Record<string, unknown>[] = [];
  const FlashList = ReactLocal.forwardRef(
    (props: Record<string, unknown>, ref: unknown) => {
      captured.push(props);
      ReactLocal.useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn() }));
      return ReactLocal.createElement(View, { testID: 'flash-list' });
    },
  );
  return { FlashList, __captured: captured };
});

/** A recorder standing in for the cell, so the test never boots reanimated. */
jest.mock('../../components/feed/ReelCell', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const ReelCell = (props: Record<string, unknown>): React.ReactElement =>
    ReactLocal.createElement(View, { testID: 'reel-cell', ...props });
  return { ReelCell };
});

type MockRow = Record<string, unknown> & { id: string; author_id: string };

const BASE_ROWS: MockRow[] = [
  {
    id: 'r-video', author_id: 'u1', community_id: 'c1', content: 'a clip',
    post_type: 'video', comment_count: 0, like_count: 3, feed_score: 90,
    video_url: 'https://cdn.example.test/a.m3u8', video_thumbnail_url: 'u1/a/thumb.jpg',
    created_at: '2026-08-01T00:00:00Z', profiles: { display_name: 'Mara', avatar_url: null },
    communities: { name: 'The Sapphic Club' },
  },
  {
    id: 'r-photo', author_id: 'u2', community_id: 'c1', content: 'a still',
    post_type: 'photo', comment_count: 0, like_count: 1, feed_score: 80,
    video_url: null, video_thumbnail_url: 'u2/b/thumb.jpg',
    created_at: '2026-08-01T00:00:00Z', profiles: { display_name: 'Ivy', avatar_url: null },
    communities: { name: 'The Sapphic Club' },
  },
];

/**
 * Read lazily by the mock factories below (jest hoists factories over
 * `const`). A test may swap the wall; `beforeEach` puts it back.
 */
const mockWall: { rows: MockRow[] | null } = { rows: null };
function mockRows(): MockRow[] {
  return mockWall.rows ?? BASE_ROWS;
}
const mockRpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

/**
 * A tiny query engine, not canned answers: `.in/.eq/.is` really filter, so a
 * stray filter in the code under test changes what reaches the list. The wall
 * RPC answers the way `wall_feed_page` (133) does: ids in (score, created_at,
 * id) order after the cursor, for the authors asked about.
 */
jest.mock('../../lib/supabase', () => {
  const makeQuery = (table: string): Record<string, unknown> => {
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
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
    q.order = jest.fn(() => q);
    q.limit = jest.fn(() => q);
    const source = (): Record<string, unknown>[] => (table === 'profiles'
      // Both authors own the official wall of c1 in this fixture.
      ? [{ id: 'u1', official_community_id: 'c1' }, { id: 'u2', official_community_id: 'c1' }]
      : mockRows());
    q.maybeSingle = jest.fn(() => Promise.resolve({
      data: source().filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null,
    }));
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({
        data: source().filter((r) => filters.every((f) => f(r))),
        error: null,
      }).then(resolve, reject);
    return q;
  };
  const key = (r: Record<string, unknown>): [number, string, string] =>
    [Number(r.feed_score ?? 0), String(r.created_at), String(r.id)];
  const before = (a: [number, string, string], b: [number, string, string]): boolean =>
    a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
  return {
    supabase: {
      from: jest.fn((table: string) => makeQuery(table)),
      rpc: jest.fn((fn: string, args: Record<string, unknown>) => {
        mockRpcCalls.push({ fn, args });
        if (fn !== 'wall_feed_page') return Promise.resolve({ data: [], error: null });
        const authors = args.p_author_ids as string[];
        const cursor: [number, string, string] | null = args.p_cursor_id == null ? null
          : [Number(args.p_cursor_score), String(args.p_cursor_created_at), String(args.p_cursor_id)];
        const ranked = mockRows()
          .filter((r) => authors.includes(r.author_id))
          .sort((a, b) => (before(key(a), key(b)) ? 1 : -1))
          .filter((r) => cursor === null || before(key(r), cursor))
          .slice(0, Number(args.p_limit));
        return Promise.resolve({
          data: ranked.map((r) => ({ post_id: r.id, feed_score: r.feed_score, created_at: r.created_at })),
          error: null,
        });
      }),
    },
    callEdgeFunction: jest.fn(() => Promise.resolve({ data: { ok: true }, error: null })),
  };
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
    toggleSave: jest.fn(),
    markSeen: jest.fn(),
    hidePost: jest.fn(() => Promise.resolve(true)),
  };
  const useFeedStore = (selector: (s: typeof state) => unknown): unknown => selector(state);
  useFeedStore.getState = (): typeof state => state;
  return { useFeedStore };
});

/** Focus + foreground, as `usePlaybackAllowed` reports it. Flipped per test. */
const mockPlayback = { allowed: true };
jest.mock('../../hooks/usePlaybackAllowed', () => ({
  usePlaybackAllowed: () => mockPlayback.allowed,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
jest.mock('../../components/feed/CommentSheet', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    CommentSheet: ({ visible, postId }: { visible: boolean; postId: string }) =>
      visible
        ? ReactLocal.createElement(View, { testID: 'comment-sheet', accessibilityLabel: postId })
        : null,
  };
});

interface ReelCellSpyProps {
  post: ReelRow;
  index: number;
  activeIndex: number;
  activeItemId: string | null;
  onOpenSafety: () => void;
  onOpenComments: () => void;
  interestPrompt?: React.ReactElement;
}

interface CapturedListProps {
  data: ReelRow[];
  getItemType: (item: ReelRow, index: number) => string | number | undefined;
  viewabilityConfig: {
    viewAreaCoveragePercentThreshold?: number;
    itemVisiblePercentThreshold?: number;
  };
  onViewableItemsChanged: (info: { viewableItems: { index: number | null }[] }) => void;
  renderItem: (info: { item: ReelRow; index: number }) => React.ReactElement<ReelCellSpyProps>;
  snapToInterval: number;
  decelerationRate: string;
  disableIntervalMomentum: boolean;
  pagingEnabled?: boolean;
  onScroll: (event: unknown) => void;
}

function captured(): CapturedListProps[] {
  const { __captured } = jest.requireMock('@shopify/flash-list') as {
    __captured: Record<string, unknown>[];
  };
  return __captured as unknown as CapturedListProps[];
}

/** Mount the feed and give it a measured viewport, which gates the list. */
async function mountFeed(): Promise<CapturedListProps> {
  return (await mountFeedView()).list;
}

/** The same, keeping the rendered tree — the safety sheet lives outside the list. */
async function mountFeedView(): Promise<{
  view: ReturnType<typeof render>;
  list: CapturedListProps;
}> {
  const view = render(<ReelsFeed scope="community" communityIds={['c1']} />);
  fireEvent(view.getByTestId('reels-feed'), 'layout', {
    nativeEvent: { layout: { height: 800, width: 400 } },
  });
  await waitFor(() => expect(captured().length).toBeGreaterThan(0));
  return { view, list: captured()[captured().length - 1] };
}

/** The newest props the list was handed. */
function latestList(): CapturedListProps {
  return captured()[captured().length - 1];
}

type FeedStoreMock = { markSeen: jest.Mock; hidePost: jest.Mock; hiddenPostIds: Set<string> };
type SafetyStoreMock = { blockUser: jest.Mock; muteUser: jest.Mock; mutedUserIds: string[] };

function feedStoreMock(): FeedStoreMock {
  return (jest.requireMock('../../store/feedStore') as {
    useFeedStore: { getState: () => FeedStoreMock };
  }).useFeedStore.getState();
}

function safetyStoreMock(): SafetyStoreMock {
  return (jest.requireMock('../../store/safetyStore') as {
    useSafetyStore: { getState: () => SafetyStoreMock };
  }).useSafetyStore.getState();
}

beforeEach(() => {
  captured().length = 0;
  mockPush.mockClear();
  mockWall.rows = null;
  mockRpcCalls.length = 0;
  mockPlayback.allowed = true;
  // The store mocks are module-scoped, so a "was never called with" assertion
  // would otherwise read the previous test's calls.
  feedStoreMock().markSeen.mockClear();
  feedStoreMock().hidePost.mockClear();
  feedStoreMock().hiddenPostIds = new Set();
  safetyStoreMock().blockUser.mockClear();
  safetyStoreMock().muteUser.mockReset();
  safetyStoreMock().muteUser.mockImplementation(() => Promise.resolve());
  safetyStoreMock().mutedUserIds = [];
});

describe('ReelsFeed recycling pools', () => {
  it('gives each post type its own pool instead of one shared pool', async () => {
    const props = await mountFeed();

    const video = props.data.find((row) => row.id === VIDEO_ID);
    const photo = props.data.find((row) => row.id === PHOTO_ID);
    expect(video).toBeDefined();
    expect(photo).toBeDefined();

    const videoType = props.getItemType(video as ReelRow, 0);
    const photoType = props.getItemType(photo as ReelRow, 1);

    expect(videoType).toBe('video');
    expect(photoType).toBe('photo');
    expect(videoType).not.toBe(photoType);
  });
});

describe('ReelsFeed viewability', () => {
  it('measures viewability against the viewport, not the item', async () => {
    const props = await mountFeed();

    expect(props.viewabilityConfig.viewAreaCoveragePercentThreshold).toBe(60);
    // flash-list 1.6.4 throws multipleViewabilityThresholdTypesNotSupported when
    // both are set, so the old key must be gone, not merely joined.
    expect(props.viewabilityConfig.itemVisiblePercentThreshold).toBeUndefined();
  });

  it('keeps viewabilityConfig and onViewableItemsChanged stable across re-renders', async () => {
    const first = await mountFeed();

    act(() => {
      first.onViewableItemsChanged({ viewableItems: [{ index: 1 }] });
    });
    await waitFor(() => expect(captured().length).toBeGreaterThan(1));
    const latest = captured()[captured().length - 1];

    expect(latest.viewabilityConfig).toBe(first.viewabilityConfig);
    expect(latest.onViewableItemsChanged).toBe(first.onViewableItemsChanged);
  });

  it('keeps the snap-paging setup that replaces the broken pagingEnabled', async () => {
    const props = await mountFeed();

    expect(props.pagingEnabled).toBeUndefined();
    expect(props.snapToInterval).toBe(800);
    expect(props.decelerationRate).toBe('fast');
    expect(props.disableIntervalMomentum).toBe(true);
    expect(typeof props.onScroll).toBe('function');
  });
});

describe('ReelsFeed active item', () => {
  it('tells the cell which item is active, not just which index', async () => {
    const props = await mountFeed();

    const cell = props.renderItem({ item: props.data[0], index: 0 });
    expect(cell.props.activeItemId).toBe(VIDEO_ID);
  });

  it('moves the active item id with the active index', async () => {
    const first = await mountFeed();

    act(() => {
      first.onViewableItemsChanged({ viewableItems: [{ index: 1 }] });
    });
    await waitFor(() => expect(captured().length).toBeGreaterThan(1));
    const latest = captured()[captured().length - 1];

    const cell = latest.renderItem({ item: latest.data[1], index: 1 });
    expect(cell.props.activeItemId).toBe(PHOTO_ID);
  });
});

describe('ReelsFeed safety', () => {
  it('opens the sheet on the post the ⋯ was tapped on, not on the active one', async () => {
    const { view, list } = await mountFeedView();

    expect(view.queryByTestId('safety-sheet')).toBeNull();

    const cell = list.renderItem({ item: list.data[1], index: 1 });
    act(() => { cell.props.onOpenSafety(); });

    expect(view.getByTestId('safety-sheet')).toBeTruthy();
    // Ivy owns r-photo; Mara owns the active video. The sheet must be about the
    // post whose rail was tapped.
    expect(view.getByTestId('safety-block').props.accessibilityLabel).toBe('Block Ivy');
  });

  it('hides a post from this page and records it so it does not come back', async () => {
    const { view, list } = await mountFeedView();

    const cell = list.renderItem({ item: list.data[1], index: 1 });
    act(() => { cell.props.onOpenSafety(); });
    fireEvent.press(view.getByTestId('safety-hide'));

    // `hidden_posts` (133) is what every feed RPC excludes and what loads at
    // startup, so the hide survives a relaunch. `seen_posts` never did.
    expect(feedStoreMock().hidePost).toHaveBeenCalledWith(PHOTO_ID, 'hide');
    await waitFor(() => expect(latestList().data.map((r) => r.id)).toEqual([VIDEO_ID]));
    expect(view.queryByTestId('safety-sheet')).toBeNull();
  });

  it('blocks through the block_user RPC and clears everything of hers', async () => {
    const { view, list } = await mountFeedView();

    const cell = list.renderItem({ item: list.data[0], index: 0 });
    act(() => { cell.props.onOpenSafety(); });
    fireEvent.press(view.getByTestId('safety-block'));
    fireEvent.press(view.getByTestId('safety-block-confirm'));

    // safetyStore.blockUser is the one entry point to migration 085's RPC —
    // not a second blocks table, which 008 explicitly did not create.
    await waitFor(() => expect(safetyStoreMock().blockUser).toHaveBeenCalledWith('u1'));
    // A block that leaves her next four videos in the pager is not a block.
    await waitFor(() => expect(latestList().data.map((r) => r.id)).toEqual([PHOTO_ID]));
  });

  it('reports through the reports table, not through a second path', async () => {
    const { view, list } = await mountFeedView();
    const { callEdgeFunction } = jest.requireMock('../../lib/supabase') as {
      callEdgeFunction: jest.Mock;
    };
    callEdgeFunction.mockClear();

    const cell = list.renderItem({ item: list.data[0], index: 0 });
    act(() => { cell.props.onOpenSafety(); });
    fireEvent.press(view.getByTestId('safety-report'));
    fireEvent.press(view.getByTestId('safety-reason-harassment'));
    fireEvent.press(view.getByTestId('safety-report-submit'));

    await waitFor(() => expect(callEdgeFunction).toHaveBeenCalledWith('submit-report', {
      userId: 'u1',
      contentType: 'post',
      contentId: VIDEO_ID,
      reason: 'harassment',
      detail: undefined,
    }));
    await waitFor(() => expect(view.queryByTestId('safety-done')).not.toBeNull());
  });

  it('says a report did not send when the write is refused', async () => {
    const { view, list } = await mountFeedView();
    const { callEdgeFunction } = jest.requireMock('../../lib/supabase') as {
      callEdgeFunction: jest.Mock;
    };
    callEdgeFunction.mockResolvedValueOnce({ data: null, error: 'Rate limit exceeded' });

    const cell = list.renderItem({ item: list.data[0], index: 0 });
    act(() => { cell.props.onOpenSafety(); });
    fireEvent.press(view.getByTestId('safety-report'));
    fireEvent.press(view.getByTestId('safety-reason-spam'));
    fireEvent.press(view.getByTestId('safety-report-submit'));

    // `callEdgeFunction` RETURNS its error rather than throwing, which is how
    // safetyStore.submitReport came to thank a woman for a report that never
    // landed. The feed reads the envelope.
    await waitFor(() => expect(view.queryByTestId('safety-error')).not.toBeNull());
    expect(view.queryByTestId('safety-done')).toBeNull();
  });
});

describe('ReelsFeed mute (FEED-05)', () => {
  it('mutes through safetyStore.muteUser and clears everything of hers', async () => {
    const { view, list } = await mountFeedView();

    const cell = list.renderItem({ item: list.data[0], index: 0 });
    act(() => { cell.props.onOpenSafety(); });
    fireEvent.press(view.getByTestId('safety-mute'));

    await waitFor(() => expect(safetyStoreMock().muteUser).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(latestList().data.map((r) => r.id)).toEqual([PHOTO_ID]));
  });

  it('keeps her posts and says so when the mute did not land', async () => {
    safetyStoreMock().muteUser.mockImplementation(() => Promise.reject(new Error('offline')));
    const { view, list } = await mountFeedView();

    const cell = list.renderItem({ item: list.data[0], index: 0 });
    act(() => { cell.props.onOpenSafety(); });
    fireEvent.press(view.getByTestId('safety-mute'));

    await waitFor(() => expect(view.queryByTestId('safety-error')).not.toBeNull());
    expect(latestList().data.map((r) => r.id)).toEqual([VIDEO_ID, PHOTO_ID]);
  });

  it('never shows a muted author, even when the server sends her post', async () => {
    safetyStoreMock().mutedUserIds = ['u2'];
    const list = await mountFeed();

    expect(list.data.map((r) => r.id)).toEqual([VIDEO_ID]);
  });

  it('shows a muted author on the profile she opened on purpose', async () => {
    safetyStoreMock().mutedUserIds = ['u2'];
    const view = render(<ReelsFeed scope="following" authorIds={['u2']} showMutedAuthors />);
    fireEvent(view.getByTestId('reels-feed'), 'layout', {
      nativeEvent: { layout: { height: 800, width: 400 } },
    });

    await waitFor(() => expect(latestList()?.data.map((r) => r.id)).toEqual([PHOTO_ID]));
    expect(mockRpcCalls[0].args.p_skip_muted).toBe(false);
  });
});

describe('ReelsFeed hidden posts (FEED-01)', () => {
  it('drops a post she hid earlier, even if the server still sends it', async () => {
    feedStoreMock().hiddenPostIds = new Set([VIDEO_ID]);
    const list = await mountFeed();

    expect(list.data.map((r) => r.id)).toEqual([PHOTO_ID]);
  });

  it('shows the empty state rather than bringing a hidden post back', async () => {
    feedStoreMock().hiddenPostIds = new Set([VIDEO_ID, PHOTO_ID]);
    const view = render(<ReelsFeed scope="community" communityIds={['c1']} />);

    await waitFor(() => expect(view.getByTestId('reels-feed-empty')).toBeTruthy());
  });
});

describe('ReelsFeed wall paging (FEED-02)', () => {
  /** 15 posts tied at score 0 — production had 24 such ties. */
  function tiedWall(): MockRow[] {
    return Array.from({ length: 15 }, (_, i) => ({
      ...BASE_ROWS[1],
      id: `tie-${String(i).padStart(2, '0')}`,
      author_id: 'u1',
      post_type: 'standard',
      feed_score: 0,
      created_at: '2026-10-01T00:00:00Z',
    }));
  }

  it('pages tied scores on the composite cursor and skips none of them', async () => {
    mockWall.rows = tiedWall();
    const list = await mountFeed();
    expect(list.data).toHaveLength(10);

    await act(async () => { (list as unknown as { onEndReached: () => void }).onEndReached(); });
    await waitFor(() => expect(latestList().data).toHaveLength(15));

    const second = mockRpcCalls.filter((c) => c.fn === 'wall_feed_page')[1];
    expect(second.args).toMatchObject({
      p_cursor_score: 0,
      p_cursor_created_at: '2026-10-01T00:00:00Z',
      p_skip_muted: true,
    });
    expect(second.args.p_cursor_id).toBe(list.data[9].id);
    expect(new Set(latestList().data.map((r) => r.id)).size).toBe(15);
  });

  it('asks the wall RPC for the community owners, not a feed_score filter', async () => {
    await mountFeed();

    const first = mockRpcCalls.find((c) => c.fn === 'wall_feed_page');
    expect(first?.args.p_author_ids).toEqual(['u1', 'u2']);
    expect(first?.args.p_cursor_id).toBeNull();
  });
});

describe('ReelsFeed loading and refresh (FEED-06)', () => {
  it('shows the page-shaped skeleton while the first page loads, not a spinner', () => {
    const view = render(<ReelsFeed scope="community" communityIds={['c1']} />);

    expect(view.getByTestId('feed-stage-skeleton')).toBeTruthy();
  });

  it('pulls to refresh: the first page again from a fresh cursor', async () => {
    const list = await mountFeed() as CapturedListProps & {
      onRefresh?: () => void; refreshing?: boolean;
    };
    expect(typeof list.onRefresh).toBe('function');
    const before = mockRpcCalls.length;

    await act(async () => { list.onRefresh?.(); });

    await waitFor(() => expect(mockRpcCalls.length).toBeGreaterThan(before));
    expect(mockRpcCalls[mockRpcCalls.length - 1].args.p_cursor_id).toBeNull();
    await waitFor(() => expect(
      (latestList() as unknown as { refreshing?: boolean }).refreshing,
    ).toBe(false));
  });
});

describe('ReelsFeed playback (FEED-03)', () => {
  it('tells every cell it may not play while the screen is blurred or backgrounded', async () => {
    mockPlayback.allowed = false;
    const list = await mountFeed();

    const cell = list.renderItem({ item: list.data[0], index: 0 }) as unknown as
      React.ReactElement<{ playbackAllowed: boolean; muted: boolean }>;
    expect(cell.props.playbackAllowed).toBe(false);
  });

  it('lets the active cell play when the screen is focused, and starts muted', async () => {
    const list = await mountFeed();

    const cell = list.renderItem({ item: list.data[0], index: 0 }) as unknown as
      React.ReactElement<{ playbackAllowed: boolean; muted: boolean }>;
    expect(cell.props.playbackAllowed).toBe(true);
    expect(cell.props.muted).toBe(true);
  });
});

describe('ReelsFeed comments', () => {
  it('opens the comment sheet on this feed and does not push a detail route', async () => {
    const { view, list } = await mountFeedView();

    expect(view.queryByTestId('comment-sheet')).toBeNull();

    const cell = list.renderItem({ item: list.data[0], index: 0 });
    act(() => { cell.props.onOpenComments(); });

    await waitFor(() => expect(view.getByTestId('comment-sheet')).toBeTruthy());
    expect(view.getByTestId('comment-sheet').props.accessibilityLabel).toBe(VIDEO_ID);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('ReelsFeed interest prompt', () => {
  it('offers the question on a cadence rather than on every post', async () => {
    const list = await mountFeed();

    expect(list.renderItem({ item: list.data[0], index: 0 }).props.interestPrompt)
      .toBeUndefined();
    expect(list.renderItem({ item: list.data[1], index: 5 }).props.interestPrompt)
      .toBeDefined();
  });

  it('drops the post on "not for me" and stops asking about it', async () => {
    const { view, list } = await mountFeedView();

    const cell = list.renderItem({ item: list.data[1], index: 5 });
    const offered = cell.props.interestPrompt;
    expect(offered).toBeDefined();
    const prompt = render(offered as React.ReactElement);
    fireEvent.press(prompt.getByTestId('interest-not-for-me'));

    expect(feedStoreMock().hidePost).toHaveBeenCalledWith(PHOTO_ID, 'not_for_me');
    await waitFor(() => expect(latestList().data.map((r) => r.id)).toEqual([VIDEO_ID]));
    expect(view.queryByTestId('safety-sheet')).toBeNull();
  });

  it('keeps the post on "more of this", and stops asking', async () => {
    const { list } = await mountFeedView();

    const cell = list.renderItem({ item: list.data[1], index: 5 });
    const offered = cell.props.interestPrompt;
    expect(offered).toBeDefined();
    const prompt = render(offered as React.ReactElement);
    fireEvent.press(prompt.getByTestId('interest-more-of-this'));

    // "More of this" is not a hide, and it is not a report either — the two
    // sentences do not share a control.
    expect(feedStoreMock().hidePost).not.toHaveBeenCalled();
    await waitFor(() => expect(latestList().data.map((r) => r.id)).toEqual([VIDEO_ID, PHOTO_ID]));
    expect(latestList().renderItem({ item: latestList().data[1], index: 5 }).props.interestPrompt)
      .toBeUndefined();
  });
});
