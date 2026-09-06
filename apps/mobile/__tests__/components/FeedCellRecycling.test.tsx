/**
 * What a recycled cell must forget.
 *
 * FlashList does not mount a cell per post. It keeps a pool per `getItemType`
 * and re-renders the SAME component instance with the next post's data — so
 * every piece of `useState` inside a cell survives the swipe unless something
 * clears it. `feedItemType` pools by `post_type`, which means a poll only ever
 * recycles into another poll: precisely the case where carried-over state is
 * invisible to the code and obvious to the viewer.
 *
 * Each test here re-renders one cell with a DIFFERENT `post` and asserts the
 * previous post's state is gone. Rendering the same element type in the same
 * position with new props is exactly what recycling does, so these fail against
 * a cell that only resets on mount.
 *
 * The consequence this file exists to stop: she votes on poll A, swipes, and
 * poll B opens with results showing, a checkmark on an option she never chose,
 * a tally carrying a phantom vote of hers, and no way to answer. On this
 * product a poll can be "are you out to your family".
 */
import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FeedCell } from '../../components/feed/FeedCell';
import {
  CAPTION_COLLAPSED_LINES, CAPTION_EXPANDED_LINES,
} from '../../components/feed/feedChromeTokens';
import type { ReelRow } from '../../lib/reels';

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
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: View };
});

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

const WIDTH = 400;

const BASE: ReelRow = {
  id: 'post-a',
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

function cellElement(post: ReelRow, onVote?: () => Promise<boolean>): React.ReactElement {
  return (
    <FeedCell
      post={post}
      index={0}
      activeIndex={0}
      activeItemId={post.id}
      width={WIDTH}
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
      onOpenSafety={noop}
      onVote={onVote ?? ((): Promise<boolean> => Promise.resolve(true))}
    />
  );
}

/** One cell instance, handed a second post — which is what recycling is. */
function recycle(first: ReelRow, second: ReelRow, onVote?: () => Promise<boolean>) {
  const view = render(cellElement(first, onVote));
  return {
    view,
    swipe: (): void => { view.rerender(cellElement(second, onVote)); },
  };
}

const POLL_A = makePost({
  id: 'poll-a',
  post_type: 'poll',
  content: 'Are you out to your family?\n• Yes\n• No',
  reaction_counts: { 'poll:0': 12, 'poll:1': 3 },
});

const POLL_B = makePost({
  id: 'poll-b',
  post_type: 'poll',
  content: 'Where should we meet?\n• Poblacion\n• Cubao',
  reaction_counts: { 'poll:0': 4, 'poll:1': 4 },
});

describe('PollCell recycling', () => {
  it('opens the next poll unanswered, not showing the last poll’s result', async () => {
    const { view, swipe } = recycle(POLL_A, POLL_B);

    fireEvent.press(view.getByTestId('poll-option-0'));
    // 12 + her vote out of 16.
    expect(view.getByTestId('poll-share-0').props.children).toBe('81%');

    await act(async () => { await Promise.resolve(); });
    swipe();

    // The tally must be hidden again: showing it first turns a question into a
    // bandwagon, and showing the PREVIOUS poll's tally is also a lie about what
    // this community thinks.
    expect(view.queryByTestId('poll-share-0')).toBeNull();
    expect(view.queryByTestId('poll-share-1')).toBeNull();
    expect(view.queryByTestId('poll-total')).toBeNull();
    expect(view.getByTestId('poll-question').props.children).toBe('Where should we meet?');
  });

  it('claims no vote of hers on a poll she has never seen', async () => {
    const { view, swipe } = recycle(POLL_A, POLL_B);

    fireEvent.press(view.getByTestId('poll-option-0'));
    await act(async () => { await Promise.resolve(); });
    swipe();

    expect(view.getByTestId('poll-option-0').props.accessibilityState.checked).toBe(false);
    expect(view.getByTestId('poll-option-1').props.accessibilityState.checked).toBe(false);
    expect(view.getByTestId('poll-option-0').props.accessibilityLabel).toBe('Poblacion');
  });

  it('lets her answer the next poll instead of refusing her input', async () => {
    const onVote = jest.fn(() => Promise.resolve(true));
    const { view, swipe } = recycle(POLL_A, POLL_B, onVote);

    fireEvent.press(view.getByTestId('poll-option-0'));
    await act(async () => { await Promise.resolve(); });
    swipe();

    expect(view.getByTestId('poll-option-0').props.accessibilityState.disabled).toBe(false);
    fireEvent.press(view.getByTestId('poll-option-1'));
    await waitFor(() => expect(onVote).toHaveBeenCalledTimes(2));
    expect(view.getByTestId('poll-option-1').props.accessibilityState.checked).toBe(true);
  });

  it('drops a failed vote’s error banner with the poll that failed', async () => {
    const onVote = jest.fn(() => Promise.resolve(false));
    const { view, swipe } = recycle(POLL_A, POLL_B, onVote);

    fireEvent.press(view.getByTestId('poll-option-0'));
    await waitFor(() => expect(view.queryByTestId('poll-error')).not.toBeNull());
    swipe();

    expect(view.queryByTestId('poll-error')).toBeNull();
  });
});

const GALLERY_A = makePost({
  id: 'gallery-a',
  post_type: 'gallery',
  media_urls: ['a1.jpg', 'a2.jpg', 'a3.jpg'],
});

const GALLERY_B = makePost({
  id: 'gallery-b',
  post_type: 'gallery',
  media_urls: ['b1.jpg', 'b2.jpg', 'b3.jpg'],
});

function scrollGallery(view: ReturnType<typeof render>, page: number): void {
  fireEvent.scroll(view.getByTestId('photo-cell-pager'), {
    nativeEvent: {
      contentOffset: { x: WIDTH * page, y: 0 },
      contentSize: { width: WIDTH * 3, height: 800 },
      layoutMeasurement: { width: WIDTH, height: 800 },
    },
  });
}

/** The lit dot, read off the width the active dot is given. */
function litDot(view: ReturnType<typeof render>): number {
  const dots = [0, 1, 2].map((i) => view.getByTestId(`photo-cell-dot-${i}`));
  return dots.findIndex((d) => (d.props.style as { width: number }).width > 5);
}

describe('PhotoCell recycling', () => {
  it('opens the next gallery on its first slide, not on the last one’s page', () => {
    const { view, swipe } = recycle(GALLERY_A, GALLERY_B);

    scrollGallery(view, 2);
    expect(litDot(view)).toBe(2);

    swipe();

    // A gallery that opens on slide 3 with dot 3 lit shows the wrong image with
    // a confident indicator under it.
    expect(litDot(view)).toBe(0);
    // The count lives on the dots, which are the live region — the ScrollView
    // carried it while not being `accessible`, so nothing ever read it.
    expect(view.getByTestId('photo-cell-dots').props.accessibilityLabel)
      .toBe('Photo 1 of 3');
  });

  it('forgets the last gallery’s load failure', () => {
    const { view, swipe } = recycle(GALLERY_A, GALLERY_B);

    fireEvent(view.getByTestId('photo-cell-image-0'), 'error');
    expect(view.queryByTestId('photo-cell-error')).not.toBeNull();

    swipe();

    expect(view.queryByTestId('photo-cell-error')).toBeNull();
    expect(view.queryByTestId('photo-cell-loading')).not.toBeNull();
  });
});

const LINK_A = makePost({
  id: 'link-a',
  post_type: 'resource',
  content: 'UK bi+ resources\nhttps://example.test/a',
});

const LINK_B = makePost({
  id: 'link-b',
  post_type: 'resource',
  content: 'Manila WLW reading list\nhttps://example.test/b',
});

describe('ResourceCell recycling', () => {
  it('does not carry the last link’s failure onto the next one', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    const { view, swipe } = recycle(LINK_A, LINK_B);

    fireEvent.press(view.getByTestId('resource-open'));
    await waitFor(() => expect(view.queryByTestId('resource-error')).not.toBeNull());

    swipe();

    expect(view.queryByTestId('resource-error')).toBeNull();
    expect(view.getByTestId('resource-open').props.accessibilityState.busy).toBe(false);
    spy.mockRestore();
  });
});

const LONG = 'x'.repeat(200);
const CHROME_A = makePost({ id: 'chrome-a', post_type: 'photo', media_urls: ['a.jpg'], content: LONG });
const CHROME_B = makePost({ id: 'chrome-b', post_type: 'photo', media_urls: ['b.jpg'], content: LONG });

describe('FeedCellChrome recycling', () => {
  it('re-collapses the caption, so the next post is not opened mid-sentence', () => {
    const { view, swipe } = recycle(CHROME_A, CHROME_B);

    fireEvent.press(view.getByTestId('feed-cell-more'));
    expect(view.getByTestId('feed-cell-caption').props.numberOfLines)
      .toBe(CAPTION_EXPANDED_LINES);

    swipe();

    expect(view.getByTestId('feed-cell-caption').props.numberOfLines)
      .toBe(CAPTION_COLLAPSED_LINES);
    expect(view.queryByTestId('feed-cell-more')).not.toBeNull();
    expect(view.queryByTestId('feed-cell-less')).toBeNull();
  });
});
