import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
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
import { excludeSeenReels, displayedLikeCount, initialReelIndex } from '../../lib/reels';
import type { ReelRow } from '../../lib/reels';
import { fetchAnnouncementVideos } from '../../lib/announcements';
import { ownerIdsFromProfiles } from '../../lib/officialGrant';
import { useFeedStore } from '../../store/feedStore';
import { useSafetyStore } from '../../store/safetyStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { TYPE } from '../../lib/typography';
import { STAGE, STAGE_BG } from './stageColors';
import { FeedPager } from './FeedPager';
import type { FeedPagerCell } from './FeedPager';
import { FeedCell, feedItemType } from './FeedCell';
import { FeedInterestCard } from './FeedInterestCard';
import { FeedSafetySheet } from './FeedSafetySheet';
import { CommentSheet } from './CommentSheet';
import { reportPost } from './feedSafety';
import type { ReportReason } from './feedSafety';

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
 * Which videos this list plays. Two scopes, because Roxy has two:
 *
 *  - `announcements` — the public square. Profile-wall videos, ranked by
 *    `announcement_feed` (migration 118). Follow is a bonus, not a filter.
 *    `communityIds` is not consulted.
 *  - `community` — videos on the official account that owns `communityIds`.
 *    Posts do not live on the community row.
 *  - `community-announcements` — same owner wall. Kept as a separate scope so
 *    existing call sites do not have to rename.
 *  - `following` — video by the people in `authorIds`. The Feed tab passes the
 *    viewer's `follows` ids. Friends are still request-first for DMs; they are
 *    not this list.
 */
export type ReelsScope =
  | 'announcements'
  | 'community'
  | 'community-announcements'
  | 'following';

const EMPTY_BODY: Record<ReelsScope, string> = {
  announcements: 'When someone posts a video, it plays here.',
  community: 'When this community posts a video, it plays here.',
  'community-announcements': 'This community has not posted a video yet.',
  following: 'Video from people you follow lands here. Follow someone and this fills up.',
};

interface ReelsFeedProps {
  /** Defaults to `community` — the original behaviour of this list. */
  scope?: ReelsScope;
  /** Required by both community scopes; ignored by `announcements` and `following`. */
  communityIds?: string[];
  /** Required by `following`; ignored by every other scope. */
  authorIds?: string[];
  /**
   * Open on this video rather than at the top — set when the viewer tapped a
   * video card in the announcements feed. The post is spliced in if it is not
   * already on the first page.
   */
  initialPostId?: string | null;
}

/**
 * The vertical video feed: a data source for `FeedPager`.
 *
 * The paging machinery — measurement, snap, viewability, which item is active —
 * belongs to `FeedPager` and is shared with every other surface that pages
 * full-screen content. What is left here is the part that is actually about
 * reels: the query, the cursor, the scopes, and the cell.
 *
 * Owns its own query and its own cursor rather than reading feedStore's. That
 * is deliberate: feedStore has a single `cursor`, and two lists paginating
 * through one cursor interleave their pages — scroll the cards feed, come back
 * here, and this list resumes from the other one's position. Likes and saves
 * still go through the store, because those are per-user state that both feeds
 * must agree on.
 *
 * Video also still appears in the announcements feed as a card. A tap there
 * opens this list at that post; the two surfaces are the same content in two
 * containers, the way Instagram keeps video in Home and in Reels.
 */
export function ReelsFeed({
  scope = 'community', communityIds, authorIds, initialPostId,
}: ReelsFeedProps) {
  const colors = useThemeColors();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const userId = useAuthStore((st) => st.user?.id ?? '');
  const followingIds = useFollowStore((st) => st.followingIds);
  const followAuthor = useFollowStore((st) => st.follow);
  const unfollowAuthor = useFollowStore((st) => st.unfollow);

  const [reels, setReels] = useState<ReelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialIndex, setInitialIndex] = useState(0);
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

  /** Community scopes page by feed_score; announcements page by created_at. */
  const cursorRef = useRef<number | null>(null);
  const beforeRef = useRef<string | null>(null);

  // Selector subscriptions, not the whole store: `markSeen` writes `seenPostIds`
  // on every swipe, and subscribing to the store object would re-render the
  // entire list each time a video is watched.
  const likedPostIds = useFeedStore((st) => st.likedPostIds);
  const savedPostIds = useFeedStore((st) => st.savedPostIds);
  const likeCountDeltas = useFeedStore((st) => st.likeCountDeltas);
  const toggleLike = useFeedStore((st) => st.toggleLike);
  const toggleSave = useFeedStore((st) => st.toggleSave);
  const markSeen = useFeedStore((st) => st.markSeen);

  // The one entry point for blocking anywhere in the app: it calls the
  // `block_user` RPC migration 085 added and keeps `blockedUserIds` — which
  // the chat surfaces read — in step. A second path would be a second list of
  // who is blocked, and one of them would be wrong.
  const blockUser = useSafetyStore((st) => st.blockUser);

  const load = useCallback(async () => {
    if (scope !== 'announcements' && !filterValues.length) {
      setReels([]);
      setLoading(false);
      setHasMore(false);
      return;
    }
    setLoading(true);
    setError(null);

    // Cursor and hasMore come from the RAW page, before seen videos are dropped:
    // paginating from the last KEPT row would skip every unwatched video that
    // happened to sort after a watched one.
    let raw: ReelRow[];

    if (scope === 'announcements') {
      const { page, error: rpcError } = await fetchAnnouncementVideos(null);
      if (rpcError || !page) {
        logError(rpcError ?? new Error('announcement_feed returned no page'), 'ReelsFeed.load');
        setError('Could not load videos.');
        setLoading(false);
        return;
      }
      beforeRef.current = page.before;
      setHasMore(page.hasMore);
      raw = page.rows;
    } else {
      let authorIdsForQuery = filterValues;
      if (scope === 'community' || scope === 'community-announcements') {
        const { data: owners } = await supabase
          .from('profiles')
          .select('id')
          .in('official_community_id', filterValues);
        authorIdsForQuery = ownerIdsFromProfiles(owners);
        if (!authorIdsForQuery.length) {
          setReels([]);
          setLoading(false);
          setHasMore(false);
          return;
        }
      }

      const { data, error: err } = await supabase
        .from('posts')
        .select(POST_WITH_AUTHOR_AND_COMMUNITY)
        .in('author_id', authorIdsForQuery)
        .eq('post_type', 'video')
        .is('deleted_at', null)
        .order('feed_score', { ascending: false })
        .limit(PAGE_SIZE);

      if (err) {
        logError(err, 'ReelsFeed.load');
        setError('Could not load videos.');
        setLoading(false);
        return;
      }

      raw = toReelRows(data);
      cursorRef.current = raw.length ? raw[raw.length - 1].feed_score : null;
      setHasMore(raw.length === PAGE_SIZE);
    }

    // Read seen ids imperatively — subscribing would re-run this loader every
    // time a swipe marks a video seen.
    let rows = excludeSeenReels(raw, useFeedStore.getState().seenPostIds);

    // Arrived by tapping a card whose video did not make the first page: fetch
    // that one row so "open this video" actually opens that video.
    if (initialPostId && !rows.some((r) => r.id === initialPostId)) {
      const { data: one } = await supabase
        .from('posts')
        .select(POST_WITH_AUTHOR_AND_COMMUNITY)
        .eq('id', initialPostId)
        .is('deleted_at', null)
        .maybeSingle();
      const spliced = toReelRows(one ? [one] : []);
      if (spliced.length) rows = [...spliced, ...rows];
    }

    // The pager seeds its active slot from `initialIndex` every time it rebuilds
    // the list, which is exactly what happens when this loader puts the
    // placeholder up and takes it down again.
    const startAt = initialReelIndex(rows, initialPostId);
    setReels(rows);
    setInitialIndex(startAt);
    setLoading(false);
  }, [scope, filterValues, initialPostId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    let raw: ReelRow[];

    if (scope === 'announcements') {
      if (beforeRef.current === null) return;
      setLoadingMore(true);
      const { page, error: rpcError } = await fetchAnnouncementVideos(beforeRef.current);
      if (rpcError || !page) {
        logError(rpcError ?? new Error('announcement_feed returned no page'), 'ReelsFeed.loadMore');
        setLoadingMore(false);
        return;
      }
      beforeRef.current = page.before;
      setHasMore(page.hasMore);
      raw = page.rows;
    } else {
      const cursor = cursorRef.current;
      if (cursor === null || !filterValues.length) return;
      setLoadingMore(true);

      let authorIdsForQuery = filterValues;
      if (scope === 'community' || scope === 'community-announcements') {
        const { data: owners } = await supabase
          .from('profiles')
          .select('id')
          .in('official_community_id', filterValues);
        authorIdsForQuery = ownerIdsFromProfiles(owners);
        if (!authorIdsForQuery.length) {
          setLoadingMore(false);
          setHasMore(false);
          return;
        }
      }

      const { data, error: err } = await supabase
        .from('posts')
        .select(POST_WITH_AUTHOR_AND_COMMUNITY)
        .in('author_id', authorIdsForQuery)
        .eq('post_type', 'video')
        .is('deleted_at', null)
        .lt('feed_score', cursor)
        .order('feed_score', { ascending: false })
        .limit(PAGE_SIZE);

      if (err) {
        logError(err, 'ReelsFeed.loadMore');
        setLoadingMore(false);
        return;
      }

      raw = toReelRows(data);
      cursorRef.current = raw.length ? raw[raw.length - 1].feed_score : cursorRef.current;
      setHasMore(raw.length === PAGE_SIZE);
    }

    const fresh = excludeSeenReels(raw, useFeedStore.getState().seenPostIds);
    setReels((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...fresh.filter((r) => !seen.has(r.id))];
    });
    setLoadingMore(false);
  }, [scope, filterValues, hasMore, loadingMore]);

  useEffect(() => { void load(); }, [load]);

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
   * The negative half of the feed, which it shipped without entirely.
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

  const openComments = useCallback(async (postId: string) => {
    setCommentPostId(postId);
    setSheetComments([]);
    const { comments, likedIds, error: loadError } = await loadPostComments(postId, userId);
    if (loadError) {
      logError(loadError, 'ReelsFeed.comments');
      return;
    }
    setSheetComments(comments);
    setLikedCommentIds(likedIds);
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
   * Drop a post from this viewer's feed, now and in future.
   *
   * `markSeen` upserts `seen_posts`, which is what both feed queries already
   * filter on — so this is durable rather than a local hide that comes back on
   * the next launch. Removing the row here as well is what makes it immediate:
   * the pager is holding this page, and the exclusion only applies to pages
   * fetched later.
   */
  const dropPost = useCallback((postId: string) => {
    markSeen(postId);
    setReels((prev) => prev.filter((r) => r.id !== postId));
  }, [markSeen]);

  const handleBlock = useCallback(async (post: ReelRow) => {
    await blockUser(post.author_id);
    // Everything of hers goes, not merely the post that prompted it — a block
    // that leaves her next four videos in the pager is not a block.
    setReels((prev) => prev.filter((r) => r.author_id !== post.author_id));
  }, [blockUser]);

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

  // FlashList recycles cells. Without this it has no reason to re-render one
  // when the mute state or a like changes, so a recycled cell keeps the previous
  // post's icons. The pager merges its own active-item state into this.
  const extraData = useMemo(
    () => ({ muted, likedPostIds, savedPostIds, likeCountDeltas, reducedMotion, answeredPrompts }),
    [muted, likedPostIds, savedPostIds, likeCountDeltas, reducedMotion, answeredPrompts],
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
   * data and the callbacks. Every cell type is reachable through here, so a
   * caller that hands this pager a mixed page gets a mixed feed with no further
   * work — what this particular list still fetches is video, because widening
   * the query is a feed-source change and not a cell change.
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
            onNotForMe={() => { answerPrompt(item.id); dropPost(item.id); }}
            onMoreOfThis={() => answerPrompt(item.id)}
            onDismiss={() => answerPrompt(item.id)}
          />
        ) : undefined}
      />
    );
  }, [
    muted, likedPostIds, savedPostIds, likeCountDeltas, reducedMotion, answeredPrompts,
    toggleMute, toggleLike, toggleSave, router, answerPrompt, dropPost, openComments,
    followingIds, followAuthor, unfollowAuthor, userId,
  ]);

  // The three states this surface owes a viewer. Non-null means the pager shows
  // this instead of the list — while still measuring its frame behind it, so the
  // list is ready to build the moment the placeholder clears.
  let placeholder: JSX.Element | null = null;
  if (loading) {
    placeholder = (
      <View style={s.centred}>
        <ActivityIndicator color={colors.roxy} />
      </View>
    );
  } else if (error) {
    placeholder = (
      <View style={s.centred}>
        <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
        <Text style={s.errorText}>{error}</Text>
        <TouchableOpacity
          onPress={() => void load()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={s.retry}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (reels.length === 0) {
    // Deliberately not `<EmptyState>`: that component reads `useThemeColors()`,
    // which paints light-theme ink on this permanently dark stage.
    placeholder = (
      <View style={[s.centred, s.emptyWrap]} testID="reels-feed-empty">
        <Text style={s.emptyEmoji}>🎬</Text>
        <Text style={s.emptyTitle}>No videos yet</Text>
        <Text style={s.emptyBody}>{EMPTY_BODY[scope]}</Text>
      </View>
    );
  }

  return (
    <View style={s.frame}>
      <FeedPager<ReelRow>
        testID="reels-feed"
        items={reels}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderCell={renderCell}
        extraData={extraData}
        initialIndex={initialIndex}
        placeholder={placeholder}
        onActiveItemChange={handleActiveItemChange}
        onEndReached={handleEndReached}
      />

      {/* One sheet for the whole list. It reads `safetyPost` rather than being
          rendered per cell, so opening it never depends on which cells happen
          to be mounted. */}
      <FeedSafetySheet
        post={safetyPost}
        onClose={() => setSafetyPost(null)}
        onReport={safetyPost ? handleReport(safetyPost) : noReport}
        onBlock={safetyPost ? () => handleBlock(safetyPost) : noBlock}
        onHide={safetyPost ? () => dropPost(safetyPost.id) : noHide}
      />

      <CommentSheet
        visible={commentPostId !== null}
        postId={commentPostId ?? ''}
        comments={sheetComments}
        likedCommentIds={likedCommentIds}
        currentUserId={userId}
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
const noHide = (): void => undefined;
