import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { RoxyLinkCard } from '../components/feed/RoxyLinkCard';
import type { Post } from '../types';

function makePost(linkType: 'game' | 'room' | 'event'): Post {
  return {
    id: 'rl1', author_id: 'u1', community_id: 'c1',
    content: 'come join us!!',
    media_urls: [], post_type: 'roxy_link',
    is_pinned: false, is_flagged: false, reaction_counts: {},
    comment_count: 7, like_count: 22, save_count: 3, feed_score: 15,
    blurhash: null, deleted_at: null,
    posted_as_community: false, post_tags: [],
    video_url: null, video_thumbnail_url: null,
    video_duration_secs: null, video_aspect_ratio: null,
    link_type: linkType, link_entity_id: 'entity1', link_community_id: null,
    created_at: '', updated_at: '',
    profiles: { display_name: 'Sam', avatar_url: null },
  };
}

const handlers = {
  isLiked: false, isSaved: false,
  onLike: jest.fn(), onSave: jest.fn(),
  onComment: jest.fn(), onShare: jest.fn(), onPress: jest.fn(),
};

describe('RoxyLinkCard', () => {
  it('game variant shows 🎮', () => {
    const { getByText } = render(
      <RoxyLinkCard post={makePost('game')} {...handlers} participantCount={4} entityName="Trivia Night" />
    );
    expect(getByText('🎮')).toBeTruthy();
  });

  it('game variant shows participant count', () => {
    const { getByText } = render(
      <RoxyLinkCard post={makePost('game')} {...handlers} participantCount={4} entityName="Trivia Night" />
    );
    expect(getByText('4 playing')).toBeTruthy();
  });

  it('room variant shows 🎙', () => {
    const { getByText } = render(
      <RoxyLinkCard post={makePost('room')} {...handlers} participantCount={2} entityName="Chill Chat" />
    );
    expect(getByText('🎙')).toBeTruthy();
  });

  it('event variant shows 📅', () => {
    const { getByText } = render(
      <RoxyLinkCard post={makePost('event')} {...handlers} participantCount={0} entityName="WLW Mixer" />
    );
    expect(getByText('📅')).toBeTruthy();
  });

  it('calls onPress when CTA tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <RoxyLinkCard
        post={makePost('game')} {...handlers}
        onPress={onPress} participantCount={4} entityName="Trivia Night"
      />
    );
    fireEvent.press(getByTestId('roxy-link-cta'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
