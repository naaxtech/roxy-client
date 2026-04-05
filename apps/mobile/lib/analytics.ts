import analytics from '@react-native-firebase/analytics';

export const Analytics = {
  screenView: (screenName: string) =>
    analytics().logScreenView({ screen_name: screenName, screen_class: screenName }),

  setUser: (userId: string | null) =>
    analytics().setUserId(userId),

  // Friends
  friendRequestSent: (targetUserId: string) =>
    analytics().logEvent('friend_request_sent', { target_user_id: targetUserId }),
  friendRequestAccepted: (friendshipId: string) =>
    analytics().logEvent('friend_request_accepted', { friendship_id: friendshipId }),
  friendRequestDeclined: (friendshipId: string) =>
    analytics().logEvent('friend_request_declined', { friendship_id: friendshipId }),
  friendRequestCancelled: (friendshipId: string) =>
    analytics().logEvent('friend_request_cancelled', { friendship_id: friendshipId }),
  friendRemoved: (friendshipId: string) =>
    analytics().logEvent('friend_removed', { friendship_id: friendshipId }),

  // Posts
  postCreated: (communityId: string) =>
    analytics().logEvent('post_created', { community_id: communityId }),
  postViewed: (postId: string) =>
    analytics().logEvent('post_viewed', { post_id: postId }),
  commentCreated: (postId: string) =>
    analytics().logEvent('comment_created', { post_id: postId }),

  // Communities
  communityViewed: (communityId: string) =>
    analytics().logEvent('community_viewed', { community_id: communityId }),
  communityJoined: (communityId: string) =>
    analytics().logEvent('community_joined', { community_id: communityId }),

  // Chat
  dmOpened: (conversationId: string) =>
    analytics().logEvent('dm_opened', { conversation_id: conversationId }),
  dmCreated: () =>
    analytics().logEvent('dm_created'),
  messageSent: (conversationId: string) =>
    analytics().logEvent('message_sent', { conversation_id: conversationId }),

  // Speed dating
  speedDateJoined: () =>
    analytics().logEvent('speed_date_joined'),
  speedDateCompleted: () =>
    analytics().logEvent('speed_date_completed'),

  // Roxy AI
  roxyChatOpened: () =>
    analytics().logEvent('roxy_chat_opened'),
  roxyGreetingViewed: () =>
    analytics().logEvent('roxy_greeting_viewed'),
};
