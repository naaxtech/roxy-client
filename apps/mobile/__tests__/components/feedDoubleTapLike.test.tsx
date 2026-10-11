import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FeedCell } from '../../components/feed/FeedCell';
import type { ReelRow } from '../../lib/reels';
import type { PostType } from '../../types';

/**
 * Double-tap ✿ on EVERY cell type (FEED-07, FEED-09).
 *
 * The like moment used to live on video only; a photo, a text card, a poll or
 * a resource could be liked only from the rail. Each case below renders the
 * real router and the real cell, fires the double tap the cell's own catcher
 * registered, and checks the three halves of the moment: the like (through
 * the idempotent store action), the ✿ bloom and the haptic tick.
 */

jest.mock('../../components/feed/FeedVideoPlayer', () => {
  const { View } = require('react-native');
  return { FeedVideoPlayer: () => require('react').createElement(View, { testID: 'feed-video-player' }) };
});
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `roxy:/${path}`, openURL: jest.fn() }));

/** The gesture a catcher registered, exposed on its view so a test can fire it. */
jest.mock('../../lib/feedMediaTaps', () => ({
  FEED_TAP_SLOP: 12,
  feedMediaTaps: (onDoubleTap: () => void, onSingleTap?: () => void) => ({ onDoubleTap, onSingleTap }),
}));
jest.mock('react-native-gesture-handler', () => {
  const ReactLocal = require('react');
  return {
    GestureDetector: ({ gesture, children }: { gesture: unknown; children: React.ReactElement }) =>
      ReactLocal.cloneElement(children, { gesture }),
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    withTiming: (value: number) => value,
    withSpring: (value: number) => value,
    withDelay: (_delay: number, value: number) => value,
    withSequence: (...values: number[]) => values[values.length - 1],
  };
});

const mockBursts: string[] = [];
jest.mock('../../components/feed/LikeBurst', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const LikeBurst = ReactLocal.forwardRef(
    (props: { reducedMotion: boolean }, ref: unknown) => {
      ReactLocal.useImperativeHandle(ref, () => ({
        play: () => { if (!props.reducedMotion) mockBursts.push('bloom'); },
      }));
      return ReactLocal.createElement(View, { testID: 'like-burst' });
    },
  );
  return { LikeBurst };
});

const mockImpact = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({
  impactAsync: (...args: unknown[]) => mockImpact(...(args as [])),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

function makePost(id: string, postType: PostType, overrides: Partial<ReelRow> = {}): ReelRow {
  return {
    id, author_id: 'u1', community_id: null, content: 'a post', media_urls: [],
    post_type: postType, is_pinned: false, is_flagged: false, reaction_counts: {},
    comment_count: 0, like_count: 3, save_count: 0, feed_score: 10, blurhash: null,
    deleted_at: null, posted_as_community: false, post_tags: [],
    video_url: postType === 'video' ? 'https://cdn.example.test/a.m3u8' : null,
    video_thumbnail_url: null, video_duration_secs: null, video_aspect_ratio: null,
    link_type: null, link_entity_id: null, link_community_id: null,
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    profiles: { display_name: 'Mara', avatar_url: null }, communities: null,
    ...overrides,
  };
}

const CASES: { name: string; post: ReelRow }[] = [
  { name: 'reel', post: makePost('p-video', 'video') },
  { name: 'photo', post: makePost('p-photo', 'photo', { media_urls: ['u1/a.jpg', 'u1/b.jpg'] }) },
  { name: 'text', post: makePost('p-text', 'standard', { content: 'first pride without hiding' }) },
  { name: 'poll', post: makePost('p-poll', 'poll', { content: 'Coffee or tea?\n- Coffee\n- Tea' }) },
  { name: 'resource', post: makePost('p-res', 'resource', { content: 'https://example.org/guide' }) },
  { name: 'roxy_link', post: makePost('p-link', 'roxy_link') },
];

const noop = (): void => undefined;

function renderCell(
  post: ReelRow,
  o: { liked?: boolean; reducedMotion?: boolean; onLike?: () => void; onDoubleTapLike?: () => void } = {},
) {
  return render(
    <FeedCell
      post={post}
      index={0}
      activeIndex={0}
      activeItemId={post.id}
      width={400}
      height={800}
      muted
      liked={o.liked ?? false}
      saved={false}
      likeCount={3}
      reducedMotion={o.reducedMotion ?? false}
      onToggleMute={noop}
      onLike={o.onLike ?? noop}
      onDoubleTapLike={o.onDoubleTapLike}
      onSave={noop}
      onOpenComments={noop}
      onOpenAuthor={noop}
      onOpenCommunity={noop}
      onOpenSafety={noop}
      onOpenPost={noop}
    />,
  );
}

function doubleTap(view: ReturnType<typeof render>): void {
  const catcher = view.getByTestId('feed-media-taps');
  const gesture = catcher.props.gesture as { onDoubleTap: () => void };
  gesture.onDoubleTap();
}

beforeEach(() => {
  mockBursts.length = 0;
  mockImpact.mockClear();
});

describe.each(CASES)('double-tap ✿ on a $name cell', ({ post }) => {
  it('likes through the idempotent store action, blooms and ticks', () => {
    const onDoubleTapLike = jest.fn();
    const onLike = jest.fn();
    const view = renderCell(post, { onDoubleTapLike, onLike });

    doubleTap(view);

    expect(onDoubleTapLike).toHaveBeenCalledTimes(1);
    // The rail's toggle is never used for a double tap: it would unlike.
    expect(onLike).not.toHaveBeenCalled();
    expect(mockBursts).toEqual(['bloom']);
    expect(mockImpact).toHaveBeenCalledTimes(1);
  });

  it('never unlikes a liked post without the store action, but still blooms', () => {
    const onLike = jest.fn();
    const view = renderCell(post, { liked: true, onLike });

    doubleTap(view);

    expect(onLike).not.toHaveBeenCalled();
    expect(mockBursts).toEqual(['bloom']);
  });

  it('stays still with Reduce Motion on, and the like still lands', () => {
    const onDoubleTapLike = jest.fn();
    const view = renderCell(post, { onDoubleTapLike, reducedMotion: true });

    doubleTap(view);

    expect(onDoubleTapLike).toHaveBeenCalledTimes(1);
    expect(mockBursts).toEqual([]);
    expect(mockImpact).not.toHaveBeenCalled();
  });
});

describe('the rail like', () => {
  it('ticks on a like and stays quiet on the take-back', () => {
    const onLike = jest.fn();
    const post = makePost('p-text', 'standard');
    const view = renderCell(post, { onLike });
    fireEvent.press(view.getByTestId('rail-like'));
    expect(onLike).toHaveBeenCalledTimes(1);
    expect(mockImpact).toHaveBeenCalledTimes(1);

    mockImpact.mockClear();
    const liked = renderCell(makePost('p-2', 'standard'), { onLike, liked: true });
    fireEvent.press(liked.getByTestId('rail-like'));
    expect(onLike).toHaveBeenCalledTimes(2);
    expect(mockImpact).not.toHaveBeenCalled();
  });
});

describe('a single tap', () => {
  it('does not like a photo', () => {
    const onLike = jest.fn();
    const onDoubleTapLike = jest.fn();
    const view = renderCell(CASES[1].post, { onLike, onDoubleTapLike });

    const gesture = view.getByTestId('feed-media-taps').props.gesture as { onSingleTap?: () => void };
    gesture.onSingleTap?.();

    expect(onLike).not.toHaveBeenCalled();
    expect(onDoubleTapLike).not.toHaveBeenCalled();
  });
});
