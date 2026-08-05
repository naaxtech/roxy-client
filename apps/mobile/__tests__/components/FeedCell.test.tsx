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

function cell(post: ReelRow, activeItemId: string | null = null) {
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
