import React from 'react';
import { render } from '@testing-library/react-native';
import { FeedVideoPlayer } from '../../components/feed/FeedVideoPlayer';

jest.mock('expo-image');

/**
 * A stand-in for `expo-av`'s `Video` that records its own mount/unmount.
 *
 * The real component releases its decoder in exactly one JS place —
 * `componentWillUnmount() { this.unloadAsync() }` — and natively through
 * `OnViewDestroys → onDropViewInstance() → unloadPlayerAndMediaController() →
 * mPlayerData.release()`. Both are unmount paths, so "was this component
 * unmounted?" is the whole question, and a recording class answers it directly.
 * src: https://github.com/expo/expo/blob/sdk-51/packages/expo-av/src/Video.tsx · expo-av 14.0.7 · 2026-08-05
 */
jest.mock('expo-av', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const events: { mounted: string[]; unmounted: string[] } = { mounted: [], unmounted: [] };

  class Video extends ReactLocal.Component<{ source?: { uri: string } }> {
    private label(): string {
      return this.props.source?.uri ?? '<no-source>';
    }

    componentDidMount(): void {
      events.mounted.push(this.label());
    }

    componentWillUnmount(): void {
      events.unmounted.push(this.label());
    }

    // The real class exposes these on the ref; without them the imperative
    // play/pause effect throws and every assertion below fails for the wrong
    // reason. Neither frees a decoder — `pauseAsync` is documented as exactly
    // `setStatusAsync({ shouldPlay: false })`.
    // src: https://github.com/expo/expo/blob/sdk-51/packages/expo-av/src/AV.ts · expo-av 14.0.7 · 2026-08-05
    playAsync(): Promise<void> {
      return Promise.resolve();
    }

    pauseAsync(): Promise<void> {
      return Promise.resolve();
    }

    render(): React.ReactElement {
      return ReactLocal.createElement(View, { testID: 'feed-video-surface' });
    }
  }

  return { Video, ResizeMode: { CONTAIN: 'contain' }, __events: events };
});

type DecoderEvents = { mounted: string[]; unmounted: string[] };

function decoderEvents(): DecoderEvents {
  return (jest.requireMock('expo-av') as { __events: DecoderEvents }).__events;
}

const CLIP = 'https://cdn.example.test/clip.m3u8';
const POSTER = 'author/post/thumb.jpg';

/**
 * The poster is deliberately hidden from screen readers — it is decoration over
 * a video that already carries its own label — so it only exists to a query
 * that opts into hidden elements.
 */
const HIDDEN = { includeHiddenElements: true } as const;

beforeEach(() => {
  const events = decoderEvents();
  events.mounted.length = 0;
  events.unmounted.length = 0;
});

describe('FeedVideoPlayer decoder window', () => {
  it('mounts no player at all for a cell outside the window', () => {
    const { queryByTestId } = render(
      <FeedVideoPlayer
        videoUrl={CLIP}
        posterUrl={POSTER}
        postId="p-far"
        isActive={false}
        isMuted
        index={9}
        activeIndex={0}
      />,
    );

    expect(queryByTestId('feed-video-surface')).toBeNull();
    expect(decoderEvents().mounted).toEqual([]);
  });

  it('releases the decoder when a mounted cell scrolls out of the window', () => {
    const { rerender, queryByTestId } = render(
      <FeedVideoPlayer
        videoUrl={CLIP}
        posterUrl={POSTER}
        postId="p-0"
        isActive
        isMuted
        index={0}
        activeIndex={0}
      />,
    );
    expect(queryByTestId('feed-video-surface')).not.toBeNull();

    rerender(
      <FeedVideoPlayer
        videoUrl={CLIP}
        posterUrl={POSTER}
        postId="p-0"
        isActive={false}
        isMuted
        index={0}
        activeIndex={6}
      />,
    );

    expect(queryByTestId('feed-video-surface')).toBeNull();
    expect(decoderEvents().unmounted).toEqual([CLIP]);
  });

  it('keeps the neighbouring cell loaded so a swipe lands on a decoded frame', () => {
    const { queryByTestId } = render(
      <FeedVideoPlayer
        videoUrl={CLIP}
        posterUrl={POSTER}
        postId="p-1"
        isActive={false}
        isMuted
        index={1}
        activeIndex={0}
      />,
    );

    expect(queryByTestId('feed-video-surface')).not.toBeNull();
    expect(decoderEvents().mounted).toEqual([CLIP]);
  });

  it('re-mounts a player when a released cell scrolls back into the window', () => {
    const { rerender, queryByTestId } = render(
      <FeedVideoPlayer
        videoUrl={CLIP}
        posterUrl={POSTER}
        postId="p-0"
        isActive={false}
        isMuted
        index={0}
        activeIndex={6}
      />,
    );
    expect(queryByTestId('feed-video-surface')).toBeNull();

    rerender(
      <FeedVideoPlayer
        videoUrl={CLIP}
        posterUrl={POSTER}
        postId="p-0"
        isActive
        isMuted
        index={0}
        activeIndex={0}
      />,
    );

    expect(queryByTestId('feed-video-surface')).not.toBeNull();
    expect(decoderEvents().mounted).toEqual([CLIP]);
  });

  it('treats a player with no list position as always in window', () => {
    // The single-video screen at /discover/video/[postId] passes no index.
    const { queryByTestId } = render(
      <FeedVideoPlayer videoUrl={CLIP} posterUrl={POSTER} postId="p-solo" isActive isMuted />,
    );

    expect(queryByTestId('feed-video-surface')).not.toBeNull();
  });

  it('shows the poster in place of a released player rather than a black frame', () => {
    const { getByTestId } = render(
      <FeedVideoPlayer
        videoUrl={CLIP}
        posterUrl={POSTER}
        postId="p-far"
        isActive={false}
        isMuted
        index={9}
        activeIndex={0}
      />,
    );

    expect(getByTestId('feed-video-poster', HIDDEN)).toBeTruthy();
  });

  it('renders nothing playable when there is no clip', () => {
    const { queryByTestId, getByText } = render(
      <FeedVideoPlayer videoUrl={null} posterUrl={POSTER} postId="p-empty" isActive isMuted />,
    );

    expect(queryByTestId('feed-video-surface')).toBeNull();
    expect(getByText('Video unavailable')).toBeTruthy();
  });
});

describe('FeedVideoPlayer recycling', () => {
  it('keys the poster on the post so a recycled cell never flashes the last one', () => {
    const { getByTestId } = render(
      <FeedVideoPlayer
        videoUrl={CLIP}
        posterUrl={POSTER}
        postId="p-42"
        isActive={false}
        isMuted
        index={0}
        activeIndex={0}
      />,
    );

    expect(getByTestId('feed-video-poster', HIDDEN).props.recyclingKey).toBe('p-42');
  });

  it('falls back to the poster uri when the caller has no post id', () => {
    const { getByTestId } = render(
      <FeedVideoPlayer videoUrl={CLIP} posterUrl={POSTER} isActive={false} isMuted />,
    );

    const key = getByTestId('feed-video-poster', HIDDEN).props.recyclingKey;
    expect(typeof key).toBe('string');
    expect(key).toContain(POSTER);
  });
});
