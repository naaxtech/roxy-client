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
  const FlashList = (props: Record<string, unknown>): React.ReactElement => {
    captured.push(props);
    return ReactLocal.createElement(View, { testID: 'flash-list' });
  };
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

jest.mock('../../lib/supabase', () => {
  const rows = [
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
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.is = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => Promise.resolve({ data: rows, error: null }));
  return {
    supabase: { from: jest.fn(() => chain) },
    callEdgeFunction: jest.fn(() => Promise.resolve({ data: { ok: true }, error: null })),
  };
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

interface ReelCellSpyProps {
  post: ReelRow;
  index: number;
  activeIndex: number;
  activeItemId: string | null;
  onOpenSafety: () => void;
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

function feedStoreMock(): { markSeen: jest.Mock } {
  return (jest.requireMock('../../store/feedStore') as {
    useFeedStore: { getState: () => { markSeen: jest.Mock } };
  }).useFeedStore.getState();
}

function safetyStoreMock(): { blockUser: jest.Mock } {
  return (jest.requireMock('../../store/safetyStore') as {
    useSafetyStore: { getState: () => { blockUser: jest.Mock } };
  }).useSafetyStore.getState();
}

beforeEach(() => {
  captured().length = 0;
  // The store mocks are module-scoped, so a "was never called with" assertion
  // would otherwise read the previous test's calls.
  feedStoreMock().markSeen.mockClear();
  safetyStoreMock().blockUser.mockClear();
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

    // `seen_posts` is what both feed queries already filter on, so the hide
    // survives a reload rather than being a local trick.
    expect(feedStoreMock().markSeen).toHaveBeenCalledWith(PHOTO_ID);
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

    expect(feedStoreMock().markSeen).toHaveBeenCalledWith(PHOTO_ID);
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
    expect(feedStoreMock().markSeen).not.toHaveBeenCalledWith(PHOTO_ID);
    await waitFor(() => expect(latestList().data.map((r) => r.id)).toEqual([VIDEO_ID, PHOTO_ID]));
    expect(latestList().renderItem({ item: latestList().data[1], index: 5 }).props.interestPrompt)
      .toBeUndefined();
  });
});
