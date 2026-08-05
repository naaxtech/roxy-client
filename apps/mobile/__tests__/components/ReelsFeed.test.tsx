import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ReelsFeed } from '../../components/feed/ReelsFeed';
import type { ReelRow } from '../../lib/reels';

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
  return { supabase: { from: jest.fn(() => chain) } };
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
  const view = render(<ReelsFeed scope="community" communityIds={['c1']} />);
  fireEvent(view.getByTestId('reels-feed'), 'layout', {
    nativeEvent: { layout: { height: 800, width: 400 } },
  });
  await waitFor(() => expect(captured().length).toBeGreaterThan(0));
  return captured()[captured().length - 1];
}

beforeEach(() => {
  captured().length = 0;
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
