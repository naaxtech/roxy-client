import React from 'react';
import { render } from '@testing-library/react-native';
import { ReelCell } from '../../components/feed/ReelCell';
import type { ReelRow } from '../../lib/reels';
import type { PostType } from '../../types';

/** Records what the cell asks the video subsystem to do. */
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
jest.mock('expo-linking', () => ({ createURL: (path: string) => `roxy://${path}` }));

jest.mock('react-native-gesture-handler', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const builder = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    const chainable = ['numberOfTaps', 'maxDelay', 'runOnJS', 'onEnd'];
    for (const key of chainable) self[key] = () => self;
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

function makeRow(id: string, postType: PostType): ReelRow {
  return {
    id,
    author_id: 'u1',
    community_id: 'c1',
    content: 'caption',
    media_urls: [],
    post_type: postType,
    is_pinned: false,
    is_flagged: false,
    reaction_counts: {},
    comment_count: 2,
    like_count: 7,
    save_count: 0,
    feed_score: 10,
    blurhash: null,
    deleted_at: null,
    posted_as_community: false,
    post_tags: [],
    video_url: postType === 'video' ? 'https://cdn.example.test/a.m3u8' : null,
    video_thumbnail_url: 'u1/a/thumb.jpg',
    video_duration_secs: 12,
    video_aspect_ratio: null,
    link_type: null,
    link_entity_id: null,
    link_community_id: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    profiles: { display_name: 'Mara', avatar_url: null },
    communities: { name: 'The Sapphic Club' },
  };
}

const noop = (): void => undefined;

function renderCell(post: ReelRow, activeItemId: string | null, index = 0, activeIndex = 0) {
  return render(
    <ReelCell
      post={post}
      index={index}
      activeIndex={activeIndex}
      activeItemId={activeItemId}
      width={400}
      height={800}
      muted
      liked={false}
      saved={false}
      likeCount={7}
      reducedMotion={false}
      onToggleMute={noop}
      onLike={noop}
      onSave={noop}
      onOpenComments={noop}
      onOpenAuthor={noop}
      onOpenCommunity={noop}
      onOpenSafety={noop}
    />,
  );
}

beforeEach(() => {
  videoCalls().length = 0;
});

describe('ReelCell playback lifecycle', () => {
  it('plays the active video cell', () => {
    const post = makeRow('p-video', 'video');
    renderCell(post, 'p-video');

    expect(videoCalls()[videoCalls().length - 1].isActive).toBe(true);
  });

  it('never tells a non-video cell to play, even when it is the active item', () => {
    const post = makeRow('p-photo', 'photo');
    renderCell(post, 'p-photo');

    expect(videoCalls().every((call) => call.isActive === false)).toBe(true);
  });

  it('keys active on the item id, so a shifted index cannot start the wrong clip', () => {
    const post = makeRow('p-video', 'video');
    // Index and activeIndex agree, but the active ITEM is a different post —
    // exactly what happens when a page is spliced in ahead of this one.
    renderCell(post, 'someone-else', 0, 0);

    expect(videoCalls().every((call) => call.isActive === false)).toBe(true);
  });

  it('passes the post id down so the poster can be recycling-keyed', () => {
    const post = makeRow('p-video', 'video');
    renderCell(post, 'p-video');

    expect(videoCalls()[videoCalls().length - 1].postId).toBe('p-video');
  });
});
