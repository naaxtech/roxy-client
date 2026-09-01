import analytics from '@react-native-firebase/analytics';
import { posthog } from './posthog';
import { hashUserId } from './errorLogger';

function safe(fn: () => Promise<void>): void {
  fn().catch(() => {});
}

function ph(event: string, props?: Record<string, unknown>): void {
  try { posthog?.capture(event, props as Parameters<typeof posthog.capture>[1]); } catch {}
}

export const Analytics = {
  screenView: (screenName: string) => {
    safe(() => analytics().logScreenView({ screen_name: screenName, screen_class: screenName }));
    // PostHog screen tracking handled via posthog.screen() in _layout.tsx
  },

  setUser: (userId: string | null) => {
    safe(() => analytics().setUserId(userId ? hashUserId(userId) : null));
    // PostHog identify handled via posthog.identify() in _layout.tsx
  },

  // ── The WLW Archive ───────────────────────────────────────────────────────
  //
  // An archive event is about a WORK, not about a woman. Entries are identified
  // by slug — a stable public identifier — never by title, because a title is
  // content and content is how free text leaks into an event stream. Search
  // records how many results came back and never what she typed: a query can
  // hold a person's name, a place, or something she would not want attached to
  // her session.
  //
  // `archive_vote_cast` carries `membership_status` because the funnel this
  // feature is justified by runs across it: pending → first vote → approved →
  // first review. Without the status on the vote there is no way to tell
  // whether letting pending members in converts them.
  archiveViewed: () => {
    safe(() => analytics().logEvent('archive_viewed'));
    ph('archive_viewed');
  },
  archiveSearch: (resultCount: number) => {
    safe(() => analytics().logEvent('archive_search', { result_count: resultCount }));
    ph('archive_search', { result_count: resultCount });
  },
  archiveEntryViewed: (entrySlug: string) => {
    safe(() => analytics().logEvent('archive_entry_viewed', { entry: entrySlug }));
    ph('archive_entry_viewed', { entry: entrySlug });
  },
  archiveVoteCast: (entrySlug: string, value: boolean, membershipStatus: string) => {
    const payload = { entry: entrySlug, value, membership_status: membershipStatus };
    safe(() => analytics().logEvent('archive_vote_cast', payload));
    ph('archive_vote_cast', payload);
  },
  archiveReviewPublished: (entrySlug: string) => {
    safe(() => analytics().logEvent('archive_review_published', { entry: entrySlug }));
    ph('archive_review_published', { entry: entrySlug });
  },
  archiveEntrySubmitted: () => {
    // No slug: the entry does not have one until a mod approves it, and the
    // title she typed is exactly the free text this module keeps out.
    safe(() => analytics().logEvent('archive_entry_submitted'));
    ph('archive_entry_submitted');
  },
  archiveEditSubmitted: (entrySlug: string) => {
    safe(() => analytics().logEvent('archive_edit_submitted', { entry: entrySlug }));
    ph('archive_edit_submitted', { entry: entrySlug });
  },
  archiveNoteAgreed: (entrySlug: string) => {
    safe(() => analytics().logEvent('archive_note_agreed', { entry: entrySlug }));
    ph('archive_note_agreed', { entry: entrySlug });
  },
  archiveWatchlistAdded: (entrySlug: string) => {
    safe(() => analytics().logEvent('archive_watchlist_added', { entry: entrySlug }));
    ph('archive_watchlist_added', { entry: entrySlug });
  },
  membershipApproved: () => {
    safe(() => analytics().logEvent('membership_approved'));
    ph('membership_approved');
  },

  // Friends
  friendRequestSent: (targetUserId: string) => {
    const hashed = hashUserId(targetUserId);
    safe(() => analytics().logEvent('friend_request_sent', { target_user_id: hashed }));
    ph('friend_request_sent', { target_user_id: hashed });
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
