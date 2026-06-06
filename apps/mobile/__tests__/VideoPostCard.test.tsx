import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { VideoPostCard } from '../components/feed/VideoPostCard';
import type { Post } from '../types';

jest.mock('expo-image');

function makeVideoPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'v1', author_id: 'u1', community_id: 'c1', content: 'great video',
    media_urls: [], post_type: 'video',
    is_pinned: false, is_flagged: false, reaction_counts: {},
    comment_count: 14, like_count: 890, save_count: 12, feed_score: 50,
    blurhash: null, deleted_at: null,
    video_url: 'https://cf.stream/abc/manifest.m3u8',
    video_thumbnail_url: 'u1/v1/thumb.jpg',
    video_duration_secs: 42,
    video_aspect_ratio: '4:5',
    link_type: null, link_entity_id: null, link_community_id: null,
    created_at: '', updated_at: '',
    profiles: { display_name: 'Alex', avatar_url: null },
    ...overrides,
  };
}

const handlers = {
  isLiked: false, isSaved: false,
  onLike: jest.fn(), onSave: jest.fn(),
  onComment: jest.fn(), onShare: jest.fn(), onPress: jest.fn(),
};

describe('VideoPostCard', () => {
  it('renders thumbnail', () => {
    const { getByTestId } = render(<VideoPostCard post={makeVideoPost()} {...handlers} />);
    expect(getByTestId('video-thumbnail')).toBeTruthy();
  });

  it('renders play icon overlay', () => {
    const { getByTestId } = render(<VideoPostCard post={makeVideoPost()} {...handlers} />);
    expect(getByTestId('play-icon')).toBeTruthy();
  });

  it('renders duration badge "0:42"', () => {
    const { getByText } = render(<VideoPostCard post={makeVideoPost()} {...handlers} />);
    expect(getByText('0:42')).toBeTruthy();
  });

  it('calls onPress when card tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <VideoPostCard post={makeVideoPost()} {...handlers} onPress={onPress} />
    );
    fireEvent.press(getByTestId('video-thumbnail'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
