import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';
import { normalizePost } from '../../lib/posts';
import { contentDetailPath } from '../../lib/contentNavigation';
import { POST_WITH_AUTHOR_AND_COMMUNITY } from '../../lib/supabaseQueries';
import { loadPostComments, toggleCommentLike } from '../../lib/comments';
import type { Comment } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useFollowStore } from '../../store/followStore';
import {
  excludeSeenReels, excludeHidden, excludeMutedAuthors, displayedLikeCount, initialReelIndex,
} from '../../lib/reels';
import type { ReelRow } from '../../lib/reels';
import { fetchAnnouncementPage } from '../../lib/announcements';
import type { ForYouCursor } from '../../lib/announcements';
import { fetchWallPage } from '../../lib/wallFeed';
import type { WallCursor } from '../../lib/wallFeed';
import { ownerIdsFromProfiles } from '../../lib/officialGrant';
import { useFeedStore } from '../../store/feedStore';
import { useSafetyStore } from '../../store/safetyStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { usePlaybackAllowed } from '../../hooks/usePlaybackAllowed';
import { TYPE } from '../../lib/typography';
import { STAGE, STAGE_BG } from './stageColors';
import { FeedPager } from './FeedPager';
import type { FeedPagerCell } from './FeedPager';
import { FeedCell, feedItemType } from './FeedCell';
import { FeedInterestCard } from './FeedInterestCard';
import { FeedSafetySheet } from './FeedSafetySheet';
import { FeedStageSkeleton } from './FeedStageSkeleton';
import { CommentSheet } from './CommentSheet';
import { reportPost } from './feedSafety';
import type { ReportReason } from './feedSafety';

/** Wall pages (Following, a community, a profile). For You pages at its RPC's own size. */
const PAGE_SIZE = 10;

/**
 * How often the "Are you interested in this?" card is offered.
 *
 * Often enough that a woman who wants out of a thread of content finds the
 * control without hunting for it, rare enough that it is not a toll booth
 * between posts. Offset by one so the very first page she ever sees is the
 * feed, not a question about the feed.
 */
const INTEREST_PROMPT_EVERY = 6;

/**
 * `normalizePost` returns a bare `Post` — it drops the embedded `communities`
 * join, so casting its result to `ReelRow` produced rows whose community name
 * was always undefined and every reel labelled itself "Roxy". Re-attach it.
 */
function toReelRows(data: unknown[] | null | undefined): ReelRow[] {
  return (data ?? []).map((row) => {
    const raw = row as Record<string, unknown> & { communities?: { name: string } | null };
    return { ...normalizePost(raw), communities: raw.communities ?? null };
  });
}

/**
 * Which posts this list pages. Two kinds of source, because Roxy has two:
 *
 *  - `announcements` — For You, the public square. Every profile-wall post,
 *    ranked by `feed_rank_page` (migration 133). `communityIds` is not read.
 *  - `community` — posts on the official account that owns `communityIds`.
 *    Posts do not live on the community row.
 *  - `community-announcements` — same owner wall. Kept as a separate scope so
 *    existing call sites do not have to rename.
 *  - `following` — posts by the people in `authorIds`. The Feed tab passes the
 *    viewer's `follows` ids; a profile passes that one person.
 *
 * Every wall scope pages through `wall_feed_page` (133) on a composite
 * (feed_score, created_at, id) cursor, so tied scores are never skipped.
 */
export type ReelsScope =
  | 'announcements'
  | 'community'
  | 'community-announcements'
  | 'following';

const EMPTY_BODY: Record<ReelsScope, string> = {
  announcements: 'When someone shares a post, a photo or a video, it shows up here.',
  community: 'When this community posts, it shows up here.',
  'community-announcements': 'This community has not posted yet.',
  following: 'Posts from people you follow land here. Follow someone and this fills up.',
};

interface ReelsFeedProps {
  /** Defaults to `community` — the original behaviour of this list. */
  scope?: ReelsScope;
  /** Required by both community scopes; ignored by `announcements` and `following`. */
  communityIds?: string[];
  /** Required by `following`; ignored by every other scope. */
  authorIds?: string[];
  /**
   * Open on this post rather than at the top — set when the viewer tapped a
   * post card elsewhere. The post is spliced in if it is not already on the
   * first page.
   */
  initialPostId?: string | null;
  /**
   * Keep posts by authors she muted. Only for a profile she opened on purpose:
   * a mute keeps someone out of her feeds, it does not make their profile
   * look empty when she goes looking.
   */
  showMutedAuthors?: boolean;
}

type LoadMode = 'initial' | 'refresh';

/**
 * The vertical feed: a data source for `FeedPager`.
 *
 * The paging machinery — measurement, snap, viewability, which item is active —
 * belongs to `FeedPager` and is shared with every other surface that pages
 * full-screen content. What is left here is the part that is actually about
 * the feed: the source, the cursor, the scopes, safety, and the cell.
 *
 * Owns its own query and its own cursor rather than reading feedStore's: two
 * lists paginating through one cursor interleave their pages. Likes, saves and
 * hides still go through the store, because those are per-user state every
 * surface must agree on.
 *
 * Three things keep a post off this list, each for its own reason:
 *  - hidden (`hidden_posts`, 133) — never comes back, even if the page empties;
 *  - muted author (`mutes`, 127) — gone from feeds, not from her profile;
 *  - seen — dropped while there is something unseen to show instead.
 * The server applies the first two as well; this covers the page already held.
 */
export function ReelsFeed({
  scope = 'community', communityIds, authorIds, initialPostId, showMutedAuthors = false,
}: ReelsFeedProps) {
  const colors = useThemeColors();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  // Blurred tab, pushed profile, backgrounded app: nothing plays (FEED-03).
  const playbackAllowed = usePlaybackAllowed();
  const userId = useAuthStore((st) => st.user?.id ?? '');
  const followingIds = useFollowStore((st) => st.followingIds);
  const followAuthor = useFollowStore((st) => st.follow);
  const unfollowAuthor = useFollowStore((st) => st.unfollow);

  const [reels, setReels] = useState<ReelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialIndex, setInitialIndex] = useState(0);
  // Sound is opt-in: every session starts muted.
  const [muted, setMuted] = useState(true);

  /**
   * Callers pass `[id]` or a store-derived array, and a fresh array literal on
   * every render would re-run the loader on every render. Stabilising by value
   * here rather than demanding a `useMemo` at each call site puts the fix where
   * it cannot be forgotten.
   */
  const idsKey = (communityIds ?? []).join(',');
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);

  const authorKey = (authorIds ?? []).join(',');
  const authors = useMemo(() => (authorKey ? authorKey.split(',') : []), [authorKey]);

  /**
   * Following already has author ids. Community scopes start as community ids
   * and resolve to the official owner inside `load` — posts live on that
   * account, not on the community row.
   */
  const filterValues = scope === 'following' ? authors : ids;

  /** For You pages on a ranked keyset; walls page on a score keyset. */
  const forYouCursorRef = useRef<ForYouCursor | null>(null);
  const wallCursorRef = useRef<WallCursor | null>(null);
  /** The wall authors `load` resolved, reused by `loadMore` without a second lookup. */
  const wallAuthorsRef = useRef<string[]>([]);
  /** A load that finishes after a newer one started must not paint. */
  const generationRef = useRef(0);

  // Selector subscriptions, not the whole store: `markSeen` writes `seenPostIds`
  // on every swipe, and subscribing to the store object would re-render the
  // entire list each time a post is looked at.
  const likedPostIds = useFeedStore((st) => st.likedPostIds);
  const savedPostIds = useFeedStore((st) => st.savedPostIds);
  const likeCountDeltas = useFeedStore((st) => st.likeCountDeltas);
  const hiddenPostIds = useFeedStore((st) => st.hiddenPostIds);
  const toggleLike = useFeedStore((st) => st.toggleLike);
  const toggleSave = useFeedStore((st) => st.toggleSave);
  const markSeen = useFeedStore((st) => st.markSeen);
  const hidePost = useFeedStore((st) => st.hidePost);

  // The one entry point for blocking anywhere in the app: it calls the
  // `block_user` RPC migration 085 added and keeps `blockedUserIds` — which
  // the chat surfaces read — in step. A second path would be a second list of
  // who is blocked, and one of them would be wrong.
  const blockUser = useSafetyStore((st) => st.blockUser);
  // Same rule for mutes: `mute_user` (127) through the store chat already uses.
  const muteUser = useSafetyStore((st) => st.muteUser);
  const mutedUserIds = useSafetyStore((st) => st.mutedUserIds);
  const skipMuted = !showMutedAuthors;

  /** Hidden posts and (unless this is her chosen profile view) muted authors. */
  const keepVisible = useCallback((rows: ReelRow[]): ReelRow[] => {
    const hidden = excludeHidden(rows, useFeedStore.getState().hiddenPostIds);
    return skipMuted
      ? excludeMutedAuthors(hidden, useSafetyStore.getState().mutedUserIds)
      : hidden;
  }, [skipMuted]);

  /**
   * The wall authors for this scope: the people given, or the official owners
   * of the given communities. Null when the owner lookup failed.
   */
  const resolveWallAuthors = useCallback(async (): Promise<string[] | null> => {
    if (scope === 'following') return filterValues;
    const { data: owners, error: ownersError } = await supabase
      .from('profiles')
      .select('id')
      .in('official_community_id', filterValues);
    if (ownersError) {
      logError(ownersError, 'ReelsFeed.owners');
      return null;
    }
    return ownerIdsFromProfiles(owners);
  }, [scope, filterValues]);

  const load = useCallback(async (mode: LoadMode = 'initial') => {
    const generation = ++generationRef.current;
    const stale = (): boolean => generation !== generationRef.current;

    if (scope !== 'announcements' && !filterValues.length) {
      setReels([]);
      setLoading(false);
      setRefreshing(false);
      setHasMore(false);
      return;
    }
    // A refresh keeps the page she is looking at on screen and shows the
    // pull spinner; only a first load puts the skeleton up.
    if (mode === 'initial') setLoading(true);
    setError(null);

    // Cursor and hasMore come from the RAW page, before seen, hidden or muted
    // rows are dropped: paginating from the last KEPT row would skip every
    // row that sorted after a dropped one.
    let raw: ReelRow[];

    if (scope === 'announcements') {
      // Every post type, not just video: For You is the front door and most
      // walls are text and photos. FeedCell routes each type to its own cell.
      // Do not switch the Feed tab to `fetchAnnouncementVideos` (video only).
      const { page, error: rpcError } = await fetchAnnouncementPage({ cursor: null });
      if (stale()) return;
      if (rpcError || !page) {
        logError(rpcError ?? new Error('feed_rank_page returned no page'), 'ReelsFeed.load');
        setError('Could not load the feed.');
        setLoading(false);
        setRefreshing(false);
        return;
      }
      forYouCursorRef.current = page.cursor;
      setHasMore(page.hasMore);
      raw = page.rows;
    } else {
      const wallAuthors = await resolveWallAuthors();
      if (stale()) return;
      if (wallAuthors === null) {
        setError('Could not load the feed.');
        setLoading(false);
        setRefreshing(false);
        return;
      }
      wallAuthorsRef.current = wallAuthors;
      const { page, error: wallError } = await fetchWallPage({
        authorIds: wallAuthors, limit: PAGE_SIZE, cursor: null, skipMuted,
      });
      if (stale()) return;
      if (wallError || !page) {
        logError(wallError ?? new Error('wall_feed_page returned no page'), 'ReelsFeed.load');
        setError('Could not load the feed.');
        setLoading(false);
        setRefreshing(false);
        return;
      }
      wallCursorRef.current = page.cursor;
      setHasMore(page.hasMore);
      raw = page.rows;
    }

    // Read seen ids imperatively — subscribing would re-run this loader every
    // time a swipe marks a post seen.
    let rows = keepVisible(excludeSeenReels(raw, useFeedStore.getState().seenPostIds));

    // Arrived by tapping a post that did not make the first page: fetch that
    // one row so "open this post" actually opens that post.
    if (initialPostId && !rows.some((r) => r.id === initialPostId)) {
      const { data: one } = await supabase
        .from('posts')
        .select(POST_WITH_AUTHOR_AND_COMMUNITY)
        .eq('id', initialPostId)
        .is('deleted_at', null)
        .maybeSingle();
      if (stale()) return;
      const spliced = keepVisible(toReelRows(one ? [one] : []));
      if (spliced.length) rows = [...spliced, ...rows];
    }

    // The pager seeds its active slot from `initialIndex` every time it rebuilds
    // the list, which is exactly what happens when this loader puts the
    // placeholder up and takes it down again.
    const startAt = initialReelIndex(rows, initialPostId);
    setReels(rows);
    setInitialIndex(startAt);
    setLoading(false);
    setRefreshing(false);
  }, [scope, filterValues, initialPostId, keepVisible, resolveWallAuthors, skipMuted]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    const generation = generationRef.current;

    let raw: ReelRow[];

    if (scope === 'announcements') {
      const cursor = forYouCursorRef.current;
      if (cursor === null) return;
      setLoadingMore(true);
      const { page, error: rpcError } = await fetchAnnouncementPage({ cursor });
      if (generation !== generationRef.current) { setLoadingMore(false); return; }
      if (rpcError || !page) {
        logError(rpcError ?? new Error('feed_rank_page returned no page'), 'ReelsFeed.loadMore');
        setLoadingMore(false);
        return;
      }
      forYouCursorRef.current = page.cursor;
      setHasMore(page.hasMore);
      raw = page.rows;
    } else {
      const cursor = wallCursorRef.current;
      const wallAuthors = wallAuthorsRef.current;
      if (cursor === null || !wallAuthors.length) return;
      setLoadingMore(true);
      const { page, error: wallError } = await fetchWallPage({
        authorIds: wallAuthors, limit: PAGE_SIZE, cursor, skipMuted,
      });
      if (generation !== generationRef.current) { setLoadingMore(false); return; }
      if (wallError || !page) {
        logError(wallError ?? new Error('wall_feed_page returned no page'), 'ReelsFeed.loadMore');
        setLoadingMore(false);
        return;
      }
      wallCursorRef.current = page.cursor;
      setHasMore(page.hasMore);
      raw = page.rows;
    }

    const fresh = keepVisible(excludeSeenReels(raw, useFeedStore.getState().seenPostIds));
    setReels((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...fresh.filter((r) => !seen.has(r.id))];
    });
    setLoadingMore(false);
  }, [scope, hasMore, loadingMore, loading, keepVisible, skipMuted]);

  useEffect(() => { void load('initial'); }, [load]);

  /** Pull-to-refresh: the first page again, from fresh cursors (FEED-06). */
  const refresh = useCallback(() => {
    setRefreshing(true);
    forYouCursorRef.current = null;
    wallCursorRef.current = null;
    void load('refresh');
  }, [load]);

  /**
   * Marking seen follows the pager's active item rather than viewability, so a
   * flick still records what was watched. The ref keeps a re-render from
   * re-upserting the same row.
   */
  const lastSeenRef = useRef<string | null>(null);
  const handleActiveItemChange = useCallback((itemId: string) => {
    if (lastSeenRef.current === itemId) return;
    lastSeenRef.current = itemId;
    markSeen(itemId);
  }, [markSeen]);

  /**
   * The negative half of the feed.
   *
   * `safetyPost` is the post the `⋯` was tapped on — one sheet for the whole
   * list rather than one per cell, because a modal per mounted cell is ten
   * modals. `answeredPrompts` remembers which posts have already been asked
   * "are you interested in this?", so a swipe back does not ask again.
   */
  const [safetyPost, setSafetyPost] = useState<ReelRow | null>(null);
  const [answeredPrompts, setAnsweredPrompts] = useState<ReadonlySet<string>>(new Set());
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [sheetComments, setSheetComments] = useState<Comment[]>([]);
  const [likedCommentIds, setLikedCommentIds] = useState<Set<string>>(new Set());
  /**
   * The sheet opens on the tap and the rows arrive a round trip later, so the
   * gap has to be rendered as a gap. Without these two the sheet had only
   * `comments.length === 0` to go on and showed "Be the first to comment" over
   * every single open, then snapped the thread in on top of it — and a failed
   * load stayed on that same line, telling her a busy thread was empty.
   */
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  const openComments = useCallback(async (postId: string) => {
    setCommentPostId(postId);
    setSheetComments([]);
    setCommentsError(null);
    setCommentsLoading(true);
    try {
      const { comments, likedIds, error: loadError } = await loadPostComments(postId, userId);
      if (loadError) {
        logError(loadError, 'ReelsFeed.comments');
        setCommentsError('load_failed');
        return;
      }
      setSheetComments(comments);
      setLikedCommentIds(likedIds);
    } finally {
      // `finally`, not the happy path: the early return above on a load error
      // would otherwise leave the spinner up forever.
      setCommentsLoading(false);
    }
  }, [userId]);

  const handleLikeComment = useCallback(async (commentId: string) => {
    const wasLiked = likedCommentIds.has(commentId);
    setLikedCommentIds((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
    if (!userId) return;
    await toggleCommentLike({ commentId, userId, liked: wasLiked });
  }, [likedCommentIds, userId]);

  /**
   * Drop a post from her feeds for good (FEED-01).
   *
   * `hidePost` writes `hidden_posts`, which every feed RPC excludes and which
   * is loaded at startup, so a hide survives a relaunch. Removing the row here
   * as well is what makes it immediate: the pager is holding this page.
   */
  const dropPost = useCallback((postId: string, reason: 'hide' | 'not_for_me') => {
    void hidePost(postId, reason);
    setReels((prev) => prev.filter((r) => r.id !== postId));
  }, [hidePost]);

  const handleBlock = useCallback(async (post: ReelRow) => {
    await blockUser(post.author_id);
    // Everything of hers goes, not merely the post that prompted it — a block
    // that leaves her next four posts in the pager is not a block.
    setReels((prev) => prev.filter((r) => r.author_id !== post.author_id));
  }, [blockUser]);

  const handleMute = useCallback(async (post: ReelRow) => {
    // Rejects when the RPC failed, and the sheet says so; nothing is dropped.
    await muteUser(post.author_id);
    setReels((prev) => prev.filter((r) => r.author_id !== post.author_id));
  }, [muteUser]);

  const handleReport = useCallback(
    (post: ReelRow) => (reason: ReportReason, detail: string) =>
      reportPost({ postId: post.id, authorId: post.author_id, reason, detail }),
    [],
  );

  const answerPrompt = useCallback((postId: string) => {
    setAnsweredPrompts((prev) => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  }, []);

  /**
   * What the pager shows: the held page minus anything hidden or muted since
   * it was fetched. Hides and mutes made on another screen land here too,
   * because both lists live in stores.
   */
  const visibleReels = useMemo(() => {
    const kept = excludeHidden(reels, hiddenPostIds);
    return skipMuted ? excludeMutedAuthors(kept, mutedUserIds) : kept;
  }, [reels, hiddenPostIds, mutedUserIds, skipMuted]);

  // FlashList recycles cells. Without this it has no reason to re-render one
  // when the mute state or a like changes, so a recycled cell keeps the previous
  // post's icons. The pager merges its own active-item state into this.
  const extraData = useMemo(
    () => ({
      muted, likedPostIds, savedPostIds, likeCountDeltas, reducedMotion, answeredPrompts,
      playbackAllowed,
    }),
    [muted, likedPostIds, savedPostIds, likeCountDeltas, reducedMotion, answeredPrompts,
      playbackAllowed],
  );

  /**
   * One recycling pool per post type — the router's own function, so the pool
   * key and the component choice can never drift apart. See `feedItemType`.
   */
  const getItemType = useCallback((item: ReelRow) => feedItemType(item), []);
  const keyExtractor = useCallback((item: ReelRow) => item.id, []);
  const handleEndReached = useCallback(() => { void loadMore(); }, [loadMore]);

  // Placeholders are stage surfaces, so they take STAGE ink, not `colors`.
  // See `stageColors.ts`: the ground here is forced dark in both themes, and a
  // light-theme ink on it measured 3.4:1 on the empty state.
  const s = StyleSheet.create({
    frame: { flex: 1 },
    centred: {
      flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12,
      backgroundColor: STAGE_BG,
    },
    errorText: { color: STAGE.textSecondary, textAlign: 'center', ...TYPE.bodyLg },
    retry: { color: STAGE.primaryInk, fontWeight: '700', ...TYPE.bodyLg },
    emptyWrap: { flex: 1, backgroundColor: STAGE_BG },
    emptyTitle: { color: STAGE.textPrimary, textAlign: 'center', ...TYPE.title },
    emptyBody: { color: STAGE.textSecondary, textAlign: 'center', ...TYPE.bodyLg },
    emptyEmoji: { fontSize: 40, textAlign: 'center' },
  });

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  /**
   * `FeedCell` picks the body from `post_type`; this list keeps supplying the
   * data and the callbacks. Every cell type is reachable through here.
   */
  const renderCell = useCallback(({
    item, index, activeIndex, activeItemId, width, height,
  }: FeedPagerCell<ReelRow>) => {
    // Offered on a cadence rather than on every cell, and only once per post.
    const asks = index % INTEREST_PROMPT_EVERY === INTEREST_PROMPT_EVERY - 1
      && !answeredPrompts.has(item.id);

    return (
      <FeedCell
        post={item}
        index={index}
        activeIndex={activeIndex}
        activeItemId={activeItemId}
        width={width}
        height={height}
        muted={muted}
        playbackAllowed={playbackAllowed}
        liked={likedPostIds.has(item.id)}
        saved={savedPostIds.has(item.id)}
        likeCount={displayedLikeCount(item, likeCountDeltas)}
        reducedMotion={reducedMotion}
        onToggleMute={toggleMute}
        onLike={() => void toggleLike(item.id)}
        onSave={() => void toggleSave(item.id)}
        // Comments stay on this page — the sheet, not a detail route. Pushing
        // /community/post/:id here is what made the comment button feel broken:
        // she left the feed for another view just to type.
        onOpenComments={() => { void openComments(item.id); }}
        onOpenPost={() => router.push(contentDetailPath(item.id, item.post_type) as never)}
        onOpenAuthor={() => router.push(`/user/${item.author_id}` as never)}
        following={followingIds.has(item.author_id)}
        onFollowAuthor={
          userId && item.author_id !== userId
            ? () => {
                if (followingIds.has(item.author_id)) void unfollowAuthor(userId, item.author_id);
                else void followAuthor(userId, item.author_id);
              }
            : undefined
        }
        onOpenCommunity={() => router.push(
          (item.community_id
            ? `/community/${item.community_id}`
            : `/user/${item.author_id}`) as never,
        )}
        onOpenSafety={() => setSafetyPost(item)}
        interestPrompt={asks ? (
          <FeedInterestCard
            onNotForMe={() => { answerPrompt(item.id); dropPost(item.id, 'not_for_me'); }}
            onMoreOfThis={() => answerPrompt(item.id)}
            onDismiss={() => answerPrompt(item.id)}
          />
        ) : undefined}
      />
    );
  }, [
    muted, playbackAllowed, likedPostIds, savedPostIds, likeCountDeltas, reducedMotion,
    answeredPrompts, toggleMute, toggleLike, toggleSave, router, answerPrompt, dropPost,
    openComments, followingIds, followAuthor, unfollowAuthor, userId,
  ]);

  // The three states this surface owes a viewer. Non-null means the pager shows
  // this instead of the list — while still measuring its frame behind it, so the
  // list is ready to build the moment the placeholder clears.
  let placeholder: JSX.Element | null = null;
  if (loading) {
    placeholder = <FeedStageSkeleton reducedMotion={reducedMotion} />;
  } else if (error) {
    placeholder = (
      <View style={s.centred} testID="reels-feed-error">
        <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
        <Text style={s.errorText}>{error}</Text>
        <TouchableOpacity
          testID="reels-feed-retry"
          onPress={() => void load('initial')}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={s.retry}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (visibleReels.length === 0) {
    // Deliberately not `<EmptyState>`: that component reads `useThemeColors()`,
    // which paints light-theme ink on this permanently dark stage.
    placeholder = (
      <View style={[s.centred, s.emptyWrap]} testID="reels-feed-empty">
        <Text style={s.emptyEmoji}>✿</Text>
        <Text style={s.emptyTitle}>Nothing here yet</Text>
        <Text style={s.emptyBody}>{EMPTY_BODY[scope]}</Text>
        <TouchableOpacity
          testID="reels-feed-empty-refresh"
          onPress={refresh}
          accessibilityRole="button"
          accessibilityLabel="Check for new posts"
        >
          <Text style={s.retry}>Check again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.frame}>
      <FeedPager<ReelRow>
        testID="reels-feed"
        items={visibleReels}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderCell={renderCell}
        extraData={extraData}
        initialIndex={initialIndex}
        placeholder={placeholder}
        onActiveItemChange={handleActiveItemChange}
        onEndReached={handleEndReached}
        onRefresh={refresh}
        refreshing={refreshing}
      />

      {/* One sheet for the whole list. It reads `safetyPost` rather than being
          rendered per cell, so opening it never depends on which cells happen
          to be mounted. */}
      <FeedSafetySheet
        post={safetyPost}
        onClose={() => setSafetyPost(null)}
        onReport={safetyPost ? handleReport(safetyPost) : noReport}
        onBlock={safetyPost ? () => handleBlock(safetyPost) : noBlock}
        onMute={safetyPost ? () => handleMute(safetyPost) : noMute}
        onHide={safetyPost ? () => dropPost(safetyPost.id, 'hide') : noHide}
      />

      <CommentSheet
        visible={commentPostId !== null}
        postId={commentPostId ?? ''}
        comments={sheetComments}
        likedCommentIds={likedCommentIds}
        currentUserId={userId}
        loading={commentsLoading}
        error={commentsError}
        knownCount={reels.find((r) => r.id === commentPostId)?.comment_count ?? undefined}
        onClose={() => setCommentPostId(null)}
        onCommentsChange={setSheetComments}
        onLikeComment={(id) => { void handleLikeComment(id); }}
      />
    </View>
  );
}

/**
 * Stand-ins for the closed sheet.
 *
 * `FeedSafetySheet` renders nothing without a post, so these are never called;
 * they exist so the props stay non-optional — a safety action that is allowed
 * to be undefined is a safety action somebody forgets to pass.
 */
const noReport = (): Promise<void> => Promise.resolve();
const noBlock = (): Promise<void> => Promise.resolve();
const noMute = (): Promise<void> => Promise.resolve();
const noHide = (): void => undefined;
