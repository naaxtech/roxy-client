import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ReelsFeed } from '../../../components/feed/ReelsFeed';
import { feedCellPropsEqual, type FeedCellProps } from '../../../components/feed/FeedCell';

/**
 * Jank audit #5: every page change re-rendered every mounted cell. The pager
 * puts the active item in FlashList's `extraData`, so FlashList re-runs
 * `renderItem` for each visible cell; ReelsFeed built ~10 new closures per cell
 * on each of those runs and `FeedCell` was not memoised, so all five mounted
 * cells re-rendered their whole tree right when the page landed (4 long tasks
 * per 8 swipes, max 102-244 ms, on the throttled phone).
 *
 * The list may still ask for every cell; what changes is that a cell whose own
 * inputs did not change bails out. Only the page she left and the page she
 * landed on render again.
 */
jest.setTimeout(15000);

/** A list that behaves like FlashList for this purpose: every render re-runs `renderItem` for every item. */
jest.mock('@shopify/flash-list', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const captured: Record<string, unknown>[] = [];
  const FlashList = ReactLocal.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    captured.push(props);
    ReactLocal.useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn() }));
    const data = props.data as { id: string }[];
    const renderItem = props.renderItem as (mockInfo: { item: unknown; index: number }) => unknown;
    return ReactLocal.createElement(
      View,
      { testID: 'flash-list' },
      data.map((item, index) => ReactLocal.createElement(
        ReactLocal.Fragment, { key: item.id }, renderItem({ item, index }),
      )),
    );
  });
  return { FlashList, __captured: captured };
});

/** Render counters standing in for the cell bodies: what a re-render costs is their subtree. */
const mockRenders: Record<string, number> = {};
function mockBody(testID: string) {
  return (props: { post: { id: string } }) => {
    const ReactLocal = require('react');
    const { View } = require('react-native');
    mockRenders[props.post.id] = (mockRenders[props.post.id] ?? 0) + 1;
    return ReactLocal.createElement(View, { testID });
  };
}
jest.mock('../../../components/feed/ReelCell', () => ({ ReelCell: mockBody('reel-cell') }));
jest.mock('../../../components/feed/PhotoCell', () => ({ PhotoCell: mockBody('photo-cell') }));
jest.mock('../../../components/feed/TextCell', () => ({ TextCell: mockBody('text-cell') }));

const mockFeedRows = ['p0', 'p1', 'p2', 'p3', 'p4'].map((id, i) => ({
  id,
  author_id: `u${i}`,
  community_id: null,
  content: `post ${i}`,
  post_type: i % 2 === 0 ? 'standard' : 'photo',
  comment_count: 0,
  like_count: 0,
  feed_score: 100 - i,
  video_url: null,
  video_thumbnail_url: null,
  media_urls: i % 2 === 1 ? [`https://cdn.test/photo-${i}.jpg`] : null,
  created_at: '2026-10-01T00:00:00Z',
  profiles: { display_name: `Member ${i}`, avatar_url: `https://cdn.test/face-${i}.jpg` },
  communities: null,
}));

const mockPrefetch = jest.fn((urls: readonly (string | null | undefined)[]) => urls);
jest.mock('../../../lib/imageLoading', () => ({
  ...jest.requireActual('../../../lib/imageLoading'),
  prefetchImages: (urls: readonly (string | null | undefined)[]) => mockPrefetch(urls),
}));

jest.mock('../../../lib/wallFeed', () => ({
  fetchWallPage: jest.fn(() => Promise.resolve({
    page: { rows: mockFeedRows, cursor: null, hasMore: false }, error: null,
  })),
}));

/** For You's page 1 (cache-first tests): held until a test answers it. */
const mockForYou: { next: Promise<unknown> } = { next: new Promise(() => undefined) };
jest.mock('../../../lib/announcements', () => ({
  ...jest.requireActual('../../../lib/announcements'),
  fetchAnnouncementPage: jest.fn(() => mockForYou.next),
}));

jest.mock('../../../store/authStore', () => {
  const state = { user: { id: 'u-me' } };
  const useAuthStore = (selector: (s: typeof state) => unknown): unknown => selector(state);
  useAuthStore.getState = (): typeof state => state;
  return { useAuthStore };
});

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(() => Promise.resolve({ data: [], error: null })) },
  callEdgeFunction: jest.fn(() => Promise.resolve({ data: null, error: null })),
}));

jest.mock('../../../store/safetyStore', () => {
  const state = { blockUser: jest.fn(), muteUser: jest.fn(), mutedUserIds: [] as string[] };
  const useSafetyStore = (selector: (s: typeof state) => unknown): unknown => selector(state);
  useSafetyStore.getState = (): typeof state => state;
  return { useSafetyStore };
});

jest.mock('../../../store/feedStore', () => {
  const state = {
    likedPostIds: new Set<string>(),
    savedPostIds: new Set<string>(),
    seenPostIds: new Set<string>(),
    hiddenPostIds: new Set<string>(),
    toggleSave: jest.fn(),
    markSeen: jest.fn(),
    hidePost: jest.fn(() => Promise.resolve(true)),
  };
  const useFeedStore = (selector: (s: typeof state) => unknown): unknown => selector(state);
  useFeedStore.getState = (): typeof state => state;
  return { useFeedStore };
});

jest.mock('../../../components/reactions/reactionStore', () => {
  const actual = jest.requireActual('../../../components/reactions/reactionStore');
  const state = {
    mine: {}, deltas: {}, react: jest.fn(() => Promise.resolve()), hydrate: jest.fn(() => Promise.resolve()),
  };
  const useReactionStore = (selector: (s: typeof state) => unknown): unknown => selector(state);
  useReactionStore.getState = (): typeof state => state;
  return { ...actual, useReactionStore };
});

jest.mock('../../../hooks/usePlaybackAllowed', () => ({ usePlaybackAllowed: () => true }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/feed/CommentSheet', () => ({ CommentSheet: () => null }));

interface CapturedList {
  onViewableItemsChanged: (info: { viewableItems: { index: number | null }[] }) => void;
}

function latestList(): CapturedList {
  const { __captured } = jest.requireMock('@shopify/flash-list') as { __captured: CapturedList[] };
  return __captured[__captured.length - 1];
}

async function mountFeed() {
  const view = render(<ReelsFeed scope="following" authorIds={['u0', 'u1', 'u2', 'u3', 'u4']} />);
  fireEvent(view.getByTestId('reels-feed'), 'layout', {
    nativeEvent: { layout: { height: 800, width: 400 } },
  });
  await waitFor(() => expect(view.getAllByTestId('feed-cell-a11y', { includeHiddenElements: true }).length).toBe(5));
  return view;
}

beforeEach(() => {
  for (const k of Object.keys(mockRenders)) delete mockRenders[k];
});

describe('For You page 1, cache-first (decision P2, budget F7)', () => {
  const cells = (v: ReturnType<typeof render>) => v.queryAllByTestId('feed-cell-a11y', { includeHiddenElements: true });
  const mountForYou = () => {
    const view = render(<ReelsFeed scope="announcements" />);
    fireEvent(view.getByTestId('reels-feed'), 'layout', { nativeEvent: { layout: { height: 800, width: 400 } } });
    return view;
  };

  beforeEach(async () => {
    const AsyncStorage = jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock');
    await AsyncStorage.clear();
    mockForYou.next = new Promise(() => undefined);
  });

  it('paints her last-known page 1 while the network is still out', async () => {
    const { writeCache } = jest.requireActual('../../../lib/cacheFirst');
    await writeCache('u-me', 'feed:foryou:p1', mockFeedRows.slice(0, 3));
    const view = mountForYou();
    await waitFor(() => expect(cells(view)).toHaveLength(3));
  });

  it('then shows the network page and keeps it for the next cold start', async () => {
    const { readCache, writeCache } = jest.requireActual('../../../lib/cacheFirst');
    await writeCache('u-me', 'feed:foryou:p1', mockFeedRows.slice(0, 2));
    let answer!: (v: unknown) => void;
    mockForYou.next = new Promise((r) => { answer = r; });
    const view = mountForYou();
    await waitFor(() => expect(cells(view)).toHaveLength(2));

    await act(async () => { answer({ page: { rows: mockFeedRows, cursor: null, hasMore: true }, error: null }); });
    await waitFor(() => expect(cells(view)).toHaveLength(5));
    await expect(readCache('u-me', 'feed:foryou:p1')).resolves.toHaveLength(5);
  });

  it('keeps the page she is reading when the refresh fails', async () => {
    const { writeCache } = jest.requireActual('../../../lib/cacheFirst');
    await writeCache('u-me', 'feed:foryou:p1', mockFeedRows.slice(0, 3));
    let answer!: (v: unknown) => void;
    mockForYou.next = new Promise((r) => { answer = r; });
    const view = mountForYou();
    await waitFor(() => expect(cells(view)).toHaveLength(3));

    await act(async () => { answer({ page: null, error: { message: 'offline' } }); });
    expect(cells(view)).toHaveLength(3);
    expect(view.queryByText('Could not load the feed.')).toBeNull();
  });
});

describe('ReelsFeed prefetch (budget F15)', () => {
  const warmed = () => mockPrefetch.mock.calls.flatMap(([urls]) => [...urls]);

  it('warms the first pages as soon as they arrive', async () => {
    mockPrefetch.mockClear();
    await mountFeed();
    expect(warmed()).toEqual(expect.arrayContaining([
      'https://cdn.test/face-0.jpg', 'https://cdn.test/photo-1.jpg', 'https://cdn.test/face-2.jpg',
    ]));
  });

  it('warms the next two pages when she lands on one, and no further', async () => {
    await mountFeed();
    mockPrefetch.mockClear();

    act(() => { latestList().onViewableItemsChanged({ viewableItems: [{ index: 1 }] }); });

    expect(warmed()).toEqual(expect.arrayContaining([
      'https://cdn.test/face-2.jpg', 'https://cdn.test/photo-3.jpg', 'https://cdn.test/face-3.jpg',
    ]));
    expect(warmed()).not.toContain('https://cdn.test/face-4.jpg');
  });
});

describe('ReelsFeed page change (jank audit #5)', () => {
  it('re-renders only the page she left and the page she landed on', async () => {
    await mountFeed();
    for (const k of Object.keys(mockRenders)) delete mockRenders[k];

    act(() => { latestList().onViewableItemsChanged({ viewableItems: [{ index: 1 }] }); });

    expect(mockRenders.p0).toBeGreaterThan(0);
    expect(mockRenders.p1).toBeGreaterThan(0);
    expect(mockRenders.p2 ?? 0).toBe(0);
    expect(mockRenders.p3 ?? 0).toBe(0);
    expect(mockRenders.p4 ?? 0).toBe(0);
  });

  it('re-renders nothing when the feed re-renders for a reason no cell reads', async () => {
    const view = await mountFeed();
    for (const k of Object.keys(mockRenders)) delete mockRenders[k];

    // The same props again: a parent re-render, a store tick for another screen.
    view.rerender(<ReelsFeed scope="following" authorIds={['u0', 'u1', 'u2', 'u3', 'u4']} />);

    expect(Object.values(mockRenders).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('feedCellPropsEqual — what a page change means to one cell', () => {
  const noop = () => undefined;
  const posts: Record<string, unknown> = {
    video: { ...mockFeedRows[0], id: 'v', post_type: 'video' },
    photo: { ...mockFeedRows[0], id: 'v', post_type: 'photo' },
  };
  function cellProps(postType: string, index: number, activeIndex: number) {
    return {
      post: posts[postType],
      index, activeIndex, activeItemId: `slot-${activeIndex}`,
      width: 400, height: 800, muted: true, onToggleMute: noop,
      reaction: null, reactionTotal: 0, saved: false, reducedMotion: false,
      onReact: noop, onSave: noop, onOpenComments: noop, onOpenAuthor: noop,
      onOpenCommunity: noop, onOpenSafety: noop, onOpenPost: noop,
    } as unknown as FeedCellProps;
  }

  it('wakes a video two pages ahead when she moves next to it, so its decoder starts', () => {
    expect(feedCellPropsEqual(cellProps('video', 3, 1), cellProps('video', 3, 2))).toBe(false);
  });

  it('leaves that video alone while it stays outside the window', () => {
    expect(feedCellPropsEqual(cellProps('video', 5, 1), cellProps('video', 5, 2))).toBe(true);
  });

  it('leaves a photo alone at any distance: it has no decoder', () => {
    expect(feedCellPropsEqual(cellProps('photo', 3, 1), cellProps('photo', 3, 2))).toBe(true);
  });
});
