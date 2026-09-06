import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StaticPostCard } from '../components/feed/StaticPostCard';
import type { Post } from '../types';

jest.mock('expo-image');

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'p1', author_id: 'u1', community_id: 'c1',
    content: 'hello world', media_urls: [], post_type: 'standard',
    is_pinned: false, is_flagged: false, reaction_counts: {},
    comment_count: 2, like_count: 5, save_count: 1, feed_score: 10,
    blurhash: null, deleted_at: null,
    posted_as_community: false, post_tags: [],
    video_url: null, video_thumbnail_url: null, video_duration_secs: null,
    video_aspect_ratio: null, link_type: null, link_entity_id: null,
    link_community_id: null, created_at: '', updated_at: '',
    profiles: { display_name: 'Maya', avatar_url: null },
    ...overrides,
  };
}

const handlers = {
  isLiked: false, isSaved: false,
  onLike: jest.fn(), onSave: jest.fn(),
  onComment: jest.fn(), onShare: jest.fn(), onPress: jest.fn(),
};

describe('StaticPostCard', () => {
  it('renders author name', () => {
    const { getByText } = render(<StaticPostCard post={makePost()} {...handlers} />);
    expect(getByText('Maya')).toBeTruthy();
  });

  it('text post has no image', () => {
    const { queryByTestId } = render(
      <StaticPostCard post={makePost({ post_type: 'standard' })} {...handlers} />
    );
    expect(queryByTestId('post-image')).toBeNull();
  });

  it('photo post renders image', () => {
    const post = makePost({ post_type: 'photo', media_urls: ['u1/p1/img.jpg'] });
    const { getByTestId } = render(<StaticPostCard post={post} {...handlers} />);
    expect(getByTestId('post-image')).toBeTruthy();
  });

  it('gallery shows dot indicators for 2+ images', () => {
    const post = makePost({
      post_type: 'gallery',
      media_urls: ['a.jpg', 'b.jpg', 'c.jpg'],
    });
    const { getByTestId } = render(<StaticPostCard post={post} {...handlers} />);
    expect(getByTestId('gallery-dots')).toBeTruthy();
  });

  it('calls onPress when card tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <StaticPostCard post={makePost()} {...handlers} onPress={onPress} />
    );
    fireEvent.press(getByTestId('static-card-press'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows Show more for long captions', () => {
    const long = 'x'.repeat(200);
    const post = makePost({ post_type: 'photo', media_urls: ['img.jpg'], content: long });
    const { getByText } = render(<StaticPostCard post={post} {...handlers} />);
    expect(getByText('Show more')).toBeTruthy();
  });

  it('tapping Show more expands caption', () => {
    const long = 'x'.repeat(200);
    const post = makePost({ post_type: 'photo', media_urls: ['img.jpg'], content: long });
    const { getByText, queryByText } = render(<StaticPostCard post={post} {...handlers} />);
    fireEvent.press(getByText('Show more'));
    expect(queryByText('Show more')).toBeNull();
  });
});
