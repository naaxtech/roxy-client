import React from 'react';
import type { Post } from '../../types';
import { StaticPostCard } from './StaticPostCard';
import { VideoPostCard } from './VideoPostCard';
import { RoxyLinkCard } from './RoxyLinkCard';

export interface FeedCardHandlers {
  isLiked: boolean;
  isSaved: boolean;
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onPress: () => void;
}

interface FeedCardProps extends FeedCardHandlers {
  post: Post;
  linkEntityName?: string;
}

const LINK_TYPE_LABELS = { game: 'Game', room: 'Room', event: 'Event' } as const;

export function FeedCard({ post, linkEntityName, ...handlers }: FeedCardProps) {
  switch (post.post_type) {
    case 'video':
      return <VideoPostCard post={post} {...handlers} />;
    case 'roxy_link':
      return (
        <RoxyLinkCard
          post={post}
          {...handlers}
          entityName={
            linkEntityName ??
            LINK_TYPE_LABELS[post.link_type ?? 'game'] ??
            'Roxy Link'
          }
          participantCount={0}
        />
      );
    default:
      return <StaticPostCard post={post} {...handlers} />;
  }
}
