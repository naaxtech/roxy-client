import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { FeedCell } from '../../components/feed/FeedCell';
import { FeedInterestCard } from '../../components/feed/FeedInterestCard';
import { FeedSafetySheet } from '../../components/feed/FeedSafetySheet';
import { MIN_INLINE_TOUCH_TARGET, MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import type { ReelRow } from '../../lib/reels';
import type { PostType } from '../../types';

jest.mock('../../components/feed/FeedVideoPlayer', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    FeedVideoPlayer: (): React.ReactElement =>
      ReactLocal.createElement(View, { testID: 'feed-video-player' }),
  };
});

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `roxy:/${path}` }));

jest.mock('react-native-gesture-handler', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const builder = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    for (const key of ['numberOfTaps', 'maxDelay', 'runOnJS', 'onEnd']) self[key] = () => self;
    return self;
  };
  return {
    Gesture: { Tap: builder, Exclusive: builder },
    GestureDetector: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement(View, null, children),
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
    withDelay: (_delay: number, value: number) => value,
    withSequence: (...values: number[]) => values[values.length - 1],
  };
});

const BASE: ReelRow = {
  id: 'p1',
  author_id: 'u1',
  community_id: 'c1',
  content: 'sunday market with the girls, and a caption long enough to earn a more affordance '
    + 'because eighty characters is the cap',
  media_urls: [],
  post_type: 'standard',
  is_pinned: false,
  is_flagged: false,
  reaction_counts: {},
  comment_count: 4,
  like_count: 12,
  save_count: 0,
  feed_score: 10,
  blurhash: null,
  deleted_at: null,
  posted_as_community: false,
  post_tags: [],
  video_url: null,
  video_thumbnail_url: null,
  video_duration_secs: null,
  video_aspect_ratio: null,
  link_type: null,
  link_entity_id: null,
  link_community_id: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  profiles: { display_name: 'Mara', avatar_url: null },
  communities: { name: 'The Sapphic Club' },
};

function makePost(overrides: Partial<ReelRow> = {}): ReelRow {
  return { ...BASE, ...overrides };
}

const noop = (): void => undefined;

/** Everything a cell of this type needs to draw every control it owns. */
const FIXTURES: Partial<Record<PostType, Partial<ReelRow>>> = {
  video: { post_type: 'video', video_url: 'https://cdn.example.test/a.m3u8' },
  photo: { post_type: 'photo', media_urls: ['a.jpg', 'b.jpg'] },
  gallery: { post_type: 'gallery', media_urls: ['a.jpg', 'b.jpg', 'c.jpg'] },
  standard: { post_type: 'standard', content: 'x'.repeat(500) },
  poll: { post_type: 'poll', content: 'Next event?\n• Film night\n• Day hike' },
  resource: { post_type: 'resource', content: 'Links\nhttps://example.test/a' },
  roxy_link: { post_type: 'roxy_link', link_type: 'game', link_entity_id: 'g1' },
};

function cell(overrides: Partial<ReelRow> = {}, withFollow = false) {
  return render(
    <FeedCell
      post={makePost(overrides)}
      index={0}
      activeIndex={0}
      activeItemId="p1"
      width={390}
      height={320}
      muted
      liked={false}
      saved={false}
      likeCount={12}
      // The crest's rotation is a timer, and this file is about geometry: a
      // spinning disc would only add unwrapped Animated updates to every case.
      reducedMotion
      onToggleMute={noop}
      onLike={noop}
      onSave={noop}
      onOpenComments={noop}
      onOpenAuthor={noop}
      onOpenCommunity={noop}
      onOpenSafety={noop}
      onOpenPost={noop}
      {...(withFollow ? { onFollowAuthor: noop } : {})}
    />,
  );
}

/**
 * The shape of a rendered node this file needs. `react-test-renderer` ships no
 * types and is not a declared dependency, so the instance is described here
 * rather than imported.
 */
interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}

/** Every host node in the tree that still leans on `hitSlop`, named. */
function hitSlopped(view: { UNSAFE_root: unknown }): string[] {
  return (view.UNSAFE_root as Node)
    .findAll((n) => typeof n.type === 'string' && n.props.hitSlop !== undefined)
    .map((n) => String(n.props.testID ?? n.props.accessibilityLabel ?? n.type));
}

function box(view: { getByTestId: (id: string) => { props: { style?: unknown } } }, id: string) {
  const style = StyleSheet.flatten(view.getByTestId(id).props.style as never) as
    Record<string, number | undefined>;
  return {
    height: Number(style.minHeight ?? style.height ?? 0),
    width: Number(style.minWidth ?? style.width ?? 0),
  };
}

/**
 * Controls that are not words in a sentence, so ATF's 48dp applies to them
 * whole. Every one of these carries an icon and a plate of its own.
 */
const STANDALONE: Record<string, PostType> = {
  'rail-avatar': 'standard',
  'rail-like': 'standard',
  'rail-comment': 'standard',
  'rail-save': 'standard',
  'rail-share': 'standard',
  'rail-more': 'standard',
  'community-crest': 'standard',
  'reel-mute': 'video',
  'reel-transport': 'video',
  'text-cell-more': 'standard',
  'poll-open': 'poll',
  'resource-open': 'resource',
};

/**
 * Text links inside the identity block. Held to WCAG 2.2 SC 2.5.8's 24dp under
 * its own Inline exception, never to `hitSlop`. See `lib/touchTargets.ts`.
 */
const INLINE = ['feed-cell-handle-hit', 'feed-cell-more', 'feed-cell-community-hit'];

describe('feed touch targets are measured, never padded by hitSlop', () => {
  it.each(Object.keys(FIXTURES) as PostType[])(
    'renders a %s cell with no hitSlop anywhere in its tree',
    (postType) => {
      expect(hitSlopped(cell(FIXTURES[postType]) as never)).toEqual([]);
    },
  );

  it('renders the follow badge with no hitSlop either', () => {
    expect(hitSlopped(cell(FIXTURES.video, true) as never)).toEqual([]);
  });

  it('offers no hitSlop on the interest card', () => {
    const view = render(
      <FeedInterestCard onNotForMe={noop} onMoreOfThis={noop} onDismiss={noop} />,
    );

    expect(hitSlopped(view as never)).toEqual([]);
  });

  it('offers no hitSlop on the safety sheet', () => {
    const view = render(
      <FeedSafetySheet
        post={makePost()}
        onClose={noop}
        onReport={() => Promise.resolve()}
        onBlock={() => Promise.resolve()}
        onHide={noop}
      />,
    );

    expect(hitSlopped(view as never)).toEqual([]);
  });

  it.each(Object.entries(STANDALONE))(
    'measures %s at the 48dp ATF floor on its own style',
    (testID, postType) => {
      const view = cell(FIXTURES[postType]);

      const { height, width } = box(view as never, testID);
      expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    },
  );

  it('measures the follow badge at the 48dp floor, not a 20dp plate plus hitSlop', () => {
    const view = cell(FIXTURES.video, true);

    const { height, width } = box(view as never, 'rail-follow');
    expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it.each(['interest-close', 'interest-not-for-me', 'interest-more-of-this'])(
    'measures %s on the interest card at the 48dp floor',
    (testID) => {
      const view = render(
        <FeedInterestCard onNotForMe={noop} onMoreOfThis={noop} onDismiss={noop} />,
      );

      expect(box(view as never, testID).height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    },
  );

  it('measures the safety sheet close control at the 48dp floor', () => {
    const view = render(
      <FeedSafetySheet
        post={makePost()}
        onClose={noop}
        onReport={() => Promise.resolve()}
        onBlock={() => Promise.resolve()}
        onHide={noop}
      />,
    );

    const { height, width } = box(view as never, 'safety-close');
    expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it.each(INLINE)('measures %s at WCAG 2.5.8 AA under the Inline exception', (testID) => {
    // 24, not 48: three 48dp boxes stacked here would add ~90dp to a band that
    // is bottom-anchored and auto-height, veiling two thirds of Connect's page.
    // A photo cell, because a text cell suppresses the caption — its body
    // already IS the words — and so never draws the "more" affordance.
    const view = cell(FIXTURES.photo);

    expect(box(view as never, testID).height).toBeGreaterThanOrEqual(MIN_INLINE_TOUCH_TARGET);
  });
});
