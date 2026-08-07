import React from 'react';
import { render } from '@testing-library/react-native';
import { FeedCell, feedItemType } from '../../components/feed/FeedCell';
import type { ReelRow } from '../../lib/reels';
import type { PostType } from '../../types';

/** Records every time a cell asks the video subsystem to do anything. */
jest.mock('../../components/feed/FeedVideoPlayer', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const calls: { isActive: boolean; postId?: string | null }[] = [];
  const FeedVideoPlayer = (
    props: { isActive: boolean; postId?: string | null },
  ): React.ReactElement => {
    calls.push({ isActive: props.isActive, postId: props.postId });
    return ReactLocal.createElement(View, { testID: 'feed-video-player' });
  };
  return { FeedVideoPlayer, __calls: calls };
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

type VideoCall = { isActive: boolean; postId?: string | null };

function videoCalls(): VideoCall[] {
  return (jest.requireMock('../../components/feed/FeedVideoPlayer') as { __calls: VideoCall[] })
    .__calls;
}

const BASE: ReelRow = {
  id: 'p1',
  author_id: 'u1',
  community_id: 'c1',
  content: 'a post',
  media_urls: [],
  post_type: 'standard',
  is_pinned: false,
  is_flagged: false,
  reaction_counts: {},
  comment_count: 0,
  like_count: 3,
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

/**
 * `activeItemId` defaults to this post: an inactive cell is now hidden from the
 * accessibility tree, and RNTL 12 excludes hidden subtrees from every query by
 * default — so a routing test rendered inactive would find nothing at all.
 * The tests that care about inactivity say so, and read through
 * `includeHiddenElements`.
 * src: https://callstack.github.io/react-native-testing-library/docs/api/queries#includehiddenelements-option · @testing-library/react-native 12.9.0 · 2026-08-07
 */
function cell(post: ReelRow, activeItemId: string | null = post.id) {
  return render(
    <FeedCell
      post={post}
      index={0}
      activeIndex={0}
      activeItemId={activeItemId}
      width={400}
      height={800}
      muted
      liked={false}
      saved={false}
      likeCount={3}
      reducedMotion={false}
      onToggleMute={noop}
      onLike={noop}
      onSave={noop}
      onOpenComments={noop}
      onOpenAuthor={noop}
      onOpenCommunity={noop}
      onOpenSafety={noop}
      onOpenPost={noop}
    />,
  );
}

beforeEach(() => {
  videoCalls().length = 0;
});

describe('feedItemType', () => {
  it('returns the post type, so FlashList keeps one recycling pool per kind', () => {
    // A constant here is the bug slice 0 fixed: FlashList would recycle a poll
    // cell's view tree into a video cell and rebuild it on every swipe.
    const types: PostType[] = [
      'standard', 'event', 'poll', 'resource', 'photo', 'gallery', 'video', 'roxy_link',
    ];

    const pools = types.map((t) => feedItemType(makePost({ post_type: t })));

    expect(pools).toEqual(types);
    expect(new Set(pools).size).toBe(types.length);
  });
});

describe('FeedCell routing', () => {
  it('renders a video post as the reel cell', () => {
    expect(cell(makePost({
      post_type: 'video', video_url: 'https://cdn.example.test/a.m3u8',
    })).queryByTestId('reel-cell')).not.toBeNull();
  });

  it('renders a photo post as the photo cell', () => {
    expect(cell(makePost({ post_type: 'photo', media_urls: ['a.jpg'] }))
      .queryByTestId('photo-cell')).not.toBeNull();
  });

  it('renders a gallery post as the photo cell', () => {
    expect(cell(makePost({ post_type: 'gallery', media_urls: ['a.jpg', 'b.jpg'] }))
      .queryByTestId('photo-cell')).not.toBeNull();
  });

  it('renders a text post as the text cell', () => {
    expect(cell(makePost({ post_type: 'standard' })).queryByTestId('text-cell')).not.toBeNull();
  });

  it('renders a poll post as the poll cell', () => {
    expect(cell(makePost({
      post_type: 'poll', content: 'Next event?\n• Film night\n• Day hike',
    })).queryByTestId('poll-cell')).not.toBeNull();
  });

  it('falls back to the text treatment for a poll with nothing to vote on', () => {
    const view = cell(makePost({ post_type: 'poll', content: 'thinking out loud' }));

    expect(view.queryByTestId('poll-cell')).toBeNull();
    expect(view.queryByTestId('text-cell')).not.toBeNull();
  });

  it('renders a resource post as the resource cell', () => {
    expect(cell(makePost({ post_type: 'resource', content: 'Links\nhttps://example.test/a' }))
      .queryByTestId('resource-cell')).not.toBeNull();
  });

  it('renders a roxy link as the resource cell', () => {
    expect(cell(makePost({ post_type: 'roxy_link', link_type: 'game', link_entity_id: 'g1' }))
      .queryByTestId('resource-cell')).not.toBeNull();
  });

  it('renders an unbuilt type as text rather than as a blank page', () => {
    // `event` and `game` cells are slice 5. Until then the pager still has to
    // page past one without showing a black screen.
    expect(cell(makePost({ post_type: 'event', content: 'Sapphic Sunday Market' }))
      .queryByTestId('text-cell')).not.toBeNull();
  });
});

describe('FeedCell video lifecycle', () => {
  it('plays the active video', () => {
    cell(makePost({ post_type: 'video', video_url: 'https://cdn.example.test/a.m3u8' }), 'p1');

    expect(videoCalls()[videoCalls().length - 1].isActive).toBe(true);
  });

  it('never mounts the video subsystem for a cell that is not a video', () => {
    // Slice 0's bug in its new form: an active NON-video cell must not be told
    // to play, and must not hold a decoder it has no use for.
    for (const post_type of ['photo', 'gallery', 'standard', 'poll', 'resource', 'roxy_link'] as
      PostType[]) {
      videoCalls().length = 0;
      const view = cell(makePost({
        post_type,
        media_urls: ['a.jpg'],
        content: 'Next event?\n• Film night\n• Day hike',
      }), 'p1');

      expect(view.queryByTestId('feed-video-player')).toBeNull();
      expect(videoCalls()).toEqual([]);
    }
  });

  it('keys playback on the item id, not on the slot', () => {
    cell(
      makePost({ post_type: 'video', video_url: 'https://cdn.example.test/a.m3u8' }),
      'someone-else',
    );

    expect(videoCalls().every((call) => call.isActive === false)).toBe(true);
  });
});

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

describe('FeedCell accessibility window', () => {
  const ALL: PostType[] = [
    'video', 'photo', 'gallery', 'standard', 'poll', 'resource', 'roxy_link', 'event',
  ];

  /** Everything a cell needs to render its richest form, whatever type it is. */
  const FURNISHED: Partial<ReelRow> = {
    video_url: 'https://cdn.example.test/a.m3u8',
    media_urls: ['a.jpg', 'b.jpg'],
    content: 'Next event?\n• Film night\n• Day hike',
  };

  it('keeps every cell the viewer is not on out of the accessibility tree', () => {
    // `drawDistance = pageH * 2` mounts about five cells, each carrying ~12
    // accessible nodes. Without this a TalkBack user swiping right from the top
    // of the visible post walks sixty controls — five "Like video", five
    // "Report, block or hide" — with no cue which post any of them belongs to,
    // and no way to reach the next post, because the pager only advances on a
    // real scroll.
    for (const post_type of ALL) {
      // `includeHiddenElements` is required HERE and nowhere else in this file,
      // and that asymmetry is the assertion. RNTL 12 excludes elements hidden
      // from accessibility by default, so an inactive cell is unreachable to the
      // same query that finds an active one — the library is confirming the gate
      // works before a single prop is inspected.
      // src: https://callstack.github.io/react-native-testing-library/docs/api/queries#includehiddenelements · @testing-library/react-native 12.9.0 · 2026-08-07
      const root = cell(makePost({ post_type, ...FURNISHED }), 'someone-else')
        .getByTestId('feed-cell-a11y', { includeHiddenElements: true });

      expect(root.props.accessibilityElementsHidden).toBe(true);
      expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    }
  });

  it('exposes the cell the viewer is actually on', () => {
    for (const post_type of ALL) {
      const root = cell(makePost({ post_type, ...FURNISHED }), 'p1')
        .getByTestId('feed-cell-a11y');

      expect(root.props.accessibilityElementsHidden).toBe(false);
      expect(root.props.importantForAccessibility).toBe('yes');
    }
  });

  it('gates the whole cell, chrome included — not merely the body', () => {
    // The rail is where the sixty nodes come from, and it is drawn by shared
    // chrome rather than by any one cell, so the gate has to sit above both.
    const root = cell(makePost({ post_type: 'video', ...FURNISHED }), 'someone-else')
      .getByTestId('feed-cell-a11y', { includeHiddenElements: true }) as unknown as Node;

    expect(root.findAll((n) => n.props.testID === 'feed-rail').length).toBeGreaterThan(0);
    expect(root.findAll((n) => n.props.testID === 'reel-cell').length).toBeGreaterThan(0);
  });

  it('sizes the gate to the page, so it cannot collapse the cell it wraps', () => {
    const root = cell(makePost(), 'p1').getByTestId('feed-cell-a11y');

    expect(root.props.style).toEqual(expect.objectContaining({ width: 400, height: 800 }));
  });
});

describe('FeedCell shared chrome', () => {
  it('gives every kind of cell the same rail and the same crest', () => {
    const types: PostType[] = ['video', 'photo', 'standard', 'poll', 'resource'];

    for (const post_type of types) {
      const view = cell(makePost({
        post_type,
        video_url: 'https://cdn.example.test/a.m3u8',
        media_urls: ['a.jpg'],
        content: 'Next event?\n• Film night\n• Day hike',
      }));

      expect(view.queryByTestId('feed-rail')).not.toBeNull();
      expect(view.queryByTestId('community-crest')).not.toBeNull();
    }
  });
});
