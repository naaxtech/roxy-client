import React from 'react';
import { act, render } from '@testing-library/react-native';
import { FeedCell } from '../../components/feed/FeedCell';
import type { ReelRow } from '../../lib/reels';
import type { PostType } from '../../types';
import type { PostReaction } from '../../lib/postReactions';

/**
 * Double-tap ❤️ on EVERY cell type (FEED-07, FEED-09; v2 › Reactions).
 *
 * v2 (Wave 2 feed): the v0 like + ✿ bloom became the reaction double tap:
 * a double tap gives ❤️ when she has no reaction, never takes one back, and
 * replays a smaller burst (adding nothing) when she already has one. The
 * haptic now STAYS under Reduce Motion (direction › Motion: "Haptics stay");
 * only the burst goes. The rail heart test became the reaction button tap.
 * Each case renders the real router and the real cell and fires the double
 * tap the cell's own catcher registered.
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
jest.mock('../../components/reactions/reactionTaps', () => ({
  reactionTaps: (onDoubleTap: unknown, onSingleTap?: unknown) => ({ onDoubleTap, onSingleTap }),
}));
jest.mock('react-native-gesture-handler', () => {
  const ReactLocal = require('react');
  return {
    GestureDetector: ({ gesture, children }: { gesture: unknown; children: React.ReactElement }) =>
      ReactLocal.cloneElement(children, { gesture }),
  };
});

const mockBursts: { small: boolean }[] = [];
jest.mock('../../components/reactions/ReactionBurst', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const ReactionBurst = ReactLocal.forwardRef(
    (_props: { reducedMotion: boolean }, ref: unknown) => {
      ReactLocal.useImperativeHandle(ref, () => ({
        play: (_at: unknown, opts?: { small?: boolean }) => { mockBursts.push({ small: opts?.small ?? false }); },
      }));
      return ReactLocal.createElement(View, { testID: 'reaction-burst' });
    },
  );
  return { ReactionBurst, BURST: { heart: 80, smallHeart: 56 } };
});

const mockImpact = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({
  impactAsync: (...args: unknown[]) => mockImpact(...(args as [])),
  selectionAsync: jest.fn(() => Promise.resolve()),
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
  o: { reaction?: PostReaction | null; reducedMotion?: boolean; onReact?: (e: PostReaction | null) => void } = {},
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
      reaction={o.reaction ?? null}
      saved={false}
      reactionTotal={3}
      reducedMotion={o.reducedMotion ?? false}
      onToggleMute={noop}
      onReact={o.onReact ?? noop}
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
  const gesture = catcher.props.gesture as { onDoubleTap: (p: { x: number; y: number }) => void };
  act(() => gesture.onDoubleTap({ x: 200, y: 400 }));
}

beforeEach(() => {
  mockBursts.length = 0;
  mockImpact.mockClear();
});

describe.each(CASES)('double-tap ❤️ on a $name cell', ({ post }) => {
  it('gives a heart, bursts and ticks', () => {
    const onReact = jest.fn();
    const view = renderCell(post, { onReact });

    doubleTap(view);

    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact).toHaveBeenCalledWith('❤️');
    expect(mockBursts).toEqual([{ small: false }]);
    expect(mockImpact).toHaveBeenCalledTimes(1);
  });

  it('never takes her reaction back or replaces it; a smaller burst answers', () => {
    const onReact = jest.fn();
    const view = renderCell(post, { reaction: '😂', onReact });

    doubleTap(view);

    expect(onReact).not.toHaveBeenCalled();
    expect(mockBursts).toEqual([{ small: true }]);
  });

  it('drops the burst with Reduce Motion on; the heart and the haptic still land', () => {
    const onReact = jest.fn();
    const view = renderCell(post, { onReact, reducedMotion: true });

    doubleTap(view);

    expect(onReact).toHaveBeenCalledWith('❤️');
    expect(mockBursts).toEqual([]);
    expect(mockImpact).toHaveBeenCalledTimes(1);
  });
});

describe('the rail reaction button', () => {
  it('ticks on a heart and stays quiet on the take-back', () => {
    const onReact = jest.fn();
    const post = makePost('p-text', 'standard');
    const view = renderCell(post, { onReact });
    const tap = (v: ReturnType<typeof render>) => {
      const button = v.getByTestId('rail-react');
      act(() => {
        button.props.onResponderGrant({ nativeEvent: { pageX: 0, pageY: 0, locationX: 24, locationY: 24 } });
        button.props.onResponderRelease({ nativeEvent: { pageX: 0, pageY: 0, locationX: 24, locationY: 24 } });
      });
    };

    tap(view);
    expect(onReact).toHaveBeenLastCalledWith('❤️');
    expect(mockImpact).toHaveBeenCalledTimes(1);

    mockImpact.mockClear();
    const reacted = renderCell(makePost('p-2', 'standard'), { onReact, reaction: '❤️' });
    tap(reacted);
    expect(onReact).toHaveBeenLastCalledWith(null);
    expect(mockImpact).not.toHaveBeenCalled();
  });
});

describe('a single tap', () => {
  it('does not react to a photo', () => {
    const onReact = jest.fn();
    const view = renderCell(CASES[1].post, { onReact });

    const gesture = view.getByTestId('feed-media-taps').props.gesture as { onSingleTap?: () => void };
    gesture.onSingleTap?.();

    expect(onReact).not.toHaveBeenCalled();
  });
});
