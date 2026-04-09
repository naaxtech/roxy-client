import analytics from '@react-native-firebase/analytics';
import { posthog } from './posthog';

function safe(fn: () => Promise<void>): void {
  fn().catch(() => {});
}

function ph(event: string, props?: Record<string, unknown>): void {
  try { posthog.capture(event, props as Parameters<typeof posthog.capture>[1]); } catch {}
}

export const Analytics = {
  screenView: (screenName: string) => {
    safe(() => analytics().logScreenView({ screen_name: screenName, screen_class: screenName }));
    // PostHog screen tracking handled via posthog.screen() in _layout.tsx
  },

  setUser: (userId: string | null) => {
    safe(() => analytics().setUserId(userId));
    // PostHog identify handled via posthog.identify() in _layout.tsx
  },

  // Friends
  friendRequestSent: (targetUserId: string) => {
    safe(() => analytics().logEvent('friend_request_sent', { target_user_id: targetUserId }));
    ph('friend_request_sent', { target_user_id: targetUserId });
  },
  friendRequestAccepted: (friendshipId: string) => {
    safe(() => analytics().logEvent('friend_request_accepted', { friendship_id: friendshipId }));
    ph('friend_request_accepted', { friendship_id: friendshipId });
  },
  friendRequestDeclined: (friendshipId: string) => {
    safe(() => analytics().logEvent('friend_request_declined', { friendship_id: friendshipId }));
    ph('friend_request_declined', { friendship_id: friendshipId });
  },
  friendRequestCancelled: (friendshipId: string) => {
    safe(() => analytics().logEvent('friend_request_cancelled', { friendship_id: friendshipId }));
    ph('friend_request_cancelled', { friendship_id: friendshipId });
  },
  friendRemoved: (friendshipId: string) => {
    safe(() => analytics().logEvent('friend_removed', { friendship_id: friendshipId }));
    ph('friend_removed', { friendship_id: friendshipId });
  },

  // Posts
  postCreated: (communityId: string) => {
    safe(() => analytics().logEvent('post_created', { community_id: communityId }));
    ph('post_created', { community_id: communityId });
  },
  postViewed: (postId: string) => {
    safe(() => analytics().logEvent('post_viewed', { post_id: postId }));
    ph('post_viewed', { post_id: postId });
  },
  commentCreated: (postId: string) => {
    safe(() => analytics().logEvent('comment_created', { post_id: postId }));
    ph('comment_created', { post_id: postId });
  },

  // Communities
  communityViewed: (communityId: string) => {
    safe(() => analytics().logEvent('community_viewed', { community_id: communityId }));
    ph('community_viewed', { community_id: communityId });
  },
  communityJoined: (communityId: string) => {
    safe(() => analytics().logEvent('community_joined', { community_id: communityId }));
    ph('community_joined', { community_id: communityId });
  },

  // Chat
  dmOpened: (conversationId: string) => {
    safe(() => analytics().logEvent('dm_opened', { conversation_id: conversationId }));
    ph('dm_opened', { conversation_id: conversationId });
  },
  dmCreated: () => {
    safe(() => analytics().logEvent('dm_created'));
    ph('dm_created');
  },
  messageSent: (conversationId: string) => {
    safe(() => analytics().logEvent('message_sent', { conversation_id: conversationId }));
    ph('message_sent', { conversation_id: conversationId });
  },

  // Speed dating
  speedDateJoined: () => {
    safe(() => analytics().logEvent('speed_date_joined'));
    ph('speed_date_joined');
  },
  speedDateCompleted: () => {
    safe(() => analytics().logEvent('speed_date_completed'));
    ph('speed_date_completed');
  },

  // Roxy AI
  roxyChatOpened: () => {
    safe(() => analytics().logEvent('roxy_chat_opened'));
    ph('roxy_chat_opened');
  },
  roxyGreetingViewed: () => {
    safe(() => analytics().logEvent('roxy_greeting_viewed'));
    ph('roxy_greeting_viewed');
  },
};
