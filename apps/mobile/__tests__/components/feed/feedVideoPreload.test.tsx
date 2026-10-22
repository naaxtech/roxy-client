import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import { FeedVideoPlayer, videoPreload } from '../../../components/feed/FeedVideoPlayer';

jest.mock('expo-image');

/**
 * Jank audit #10: on Fast 4G the app's own API calls took a median 3-6 s in
 * the feed while the backend answered in under 1 s. The active clip AND both
 * neighbours mounted `<video src>` with the browser's default preload, so up
 * to three MP4s downloaded alongside every request the screen was waiting on.
 *
 * The clip she is watching loads in full; a neighbour fetches only enough to
 * know its size and first frame, and nothing at all on a slow or data-saving
 * connection — its poster covers it until she lands there.
 */

const CLIP = 'https://cdn.example.test/clip.mp4';
const POSTER = 'author/post/thumb.jpg';

describe('videoPreload', () => {
  it('loads the clip she is watching in full', () => {
    expect(videoPreload(true, { effectiveType: '4g' })).toBe('auto');
    expect(videoPreload(true, { effectiveType: '2g', saveData: true })).toBe('auto');
  });

  it('lets a neighbour fetch only its metadata on a fast connection', () => {
    expect(videoPreload(false, { effectiveType: '4g' })).toBe('metadata');
    expect(videoPreload(false, undefined)).toBe('metadata');
  });

  it('keeps a neighbour off the network on a slow or data-saving connection', () => {
    expect(videoPreload(false, { effectiveType: '3g' })).toBe('none');
    expect(videoPreload(false, { effectiveType: 'slow-2g' })).toBe('none');
    expect(videoPreload(false, { effectiveType: '4g', saveData: true })).toBe('none');
  });
});

describe('FeedVideoPlayer on web', () => {
  const realOS = Platform.OS;
  beforeEach(() => { Platform.OS = 'web'; });
  afterEach(() => { Platform.OS = realOS; });

  function videoOf(isActive: boolean) {
    const view = render(
      <FeedVideoPlayer
        videoUrl={CLIP}
        posterUrl={POSTER}
        postId="p1"
        isActive={isActive}
        isMuted
        index={1}
        activeIndex={isActive ? 1 : 0}
      />,
    );
    return view.UNSAFE_root.findByType('video' as unknown as React.ComponentType);
  }

  it('preloads the active clip', () => {
    expect(videoOf(true).props.preload).toBe('auto');
  });

  it('does not download a neighbouring clip while she is on another page', () => {
    // An absent attribute is the browser's default, which may be a full download.
    expect(videoOf(false).props.preload).toBe('metadata');
    expect(videoOf(false).props.autoPlay).toBe(false);
  });
});
