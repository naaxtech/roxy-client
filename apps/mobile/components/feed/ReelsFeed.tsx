import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  useWindowDimensions, ViewToken,
} from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';
import { normalizePost } from '../../lib/posts';
import { contentDetailPath } from '../../lib/contentNavigation';
import { POST_WITH_AUTHOR_AND_COMMUNITY } from '../../lib/supabaseQueries';
import {
  excludeSeenReels, displayedLikeCount, activeIndexFromScroll, initialReelIndex,
} from '../../lib/reels';
import type { ReelRow } from '../../lib/reels';
import { fetchAnnouncementVideos } from '../../lib/announcements';
import { useFeedStore } from '../../store/feedStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { EmptyState } from '../ui/EmptyState';
import { ReelCell } from './ReelCell';

const PAGE_SIZE = 10;

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
 *  - `announcements` — the public square. Video announcements from EVERY
 *    community, joined or not, ranked by `announcement_feed` (migration 073).
 *    This is Connect. `communityIds` is not consulted.
 *  - `community` — member video inside `communityIds`. This is what is going on
 *    inside a community, and RLS only returns it to members.
 *  - `community-announcements` — the public face of `communityIds` only: the
 *    video a non-member is allowed to see while she decides whether to join.
 */
export type ReelsScope = 'announcements' | 'community' | 'community-announcements';

const EMPTY_BODY: Record<ReelsScope, string> = {
  announcements: 'When a community shares a video announcement, it plays here.',
  community: 'When members post video, it plays here.',
  'community-announcements': 'This community has not shared a video announcement yet.',
};

interface ReelsFeedProps {
  /** Defaults to `community` — the original behaviour of this list. */
  scope?: ReelsScope;
  /** Required by both community scopes; ignored by `announcements`. */
  communityIds?: string[];
  /**
   * Open on this video rather than at the top — set when the viewer tapped a
   * video card in the announcements feed. The post is spliced in if it is not
   * already on the first page.
   */
  initialPostId?: string | null;
}

/**
 * The vertical video feed.
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
export function ReelsFeed({ scope = 'community', communityIds, initialPostId }: ReelsFeedProps) {
  const colors = useThemeColors();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  const [reels, setReels] = useState<ReelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [initialIndex, setInitialIndex] = useState(0);
  const [muted, setMuted] = useState(true);

  /**
   * The real viewport, measured — NOT `useWindowDimensions().height`.
   *
   * This list mounts below a header and a sub-tab row and above the tab bar, so
   * the window is 150–200dp taller than the space it actually gets. Sizing a
   * page to the window overflowed every cell past its own viewport, which put
   * the action rail off-screen and dragged viewability down with it.
   *
   * Viewability no longer depends on this being right — `viewabilityConfig`
   * below is viewport-denominated now — but the measurement stays, because the
   * snap interval and `estimatedItemSize` still have to agree with the height a
   * cell is actually given.
   */
  const [pageH, setPageH] = useState(0);
  const [pageW, setPageW] = useState(0);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { height, width } = e.nativeEvent.layout;
    setPageH((prev) => (Math.abs(prev - height) < 1 ? prev : height));
    setPageW((prev) => (Math.abs(prev - width) < 1 ? prev : width));
  }, []);

  /**
   * Callers pass `[id]` or a store-derived array, and a fresh array literal on
   * every render would re-run the loader on every render. Stabilising by value
   * here rather than demanding a `useMemo` at each call site puts the fix where
   * it cannot be forgotten.
   */
  const idsKey = (communityIds ?? []).join(',');
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);

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

  /**
   * Both sources of the active index funnel through here, and the ref makes the
   * write idempotent. `onScroll` fires around 60 times a second; without the
   * guard every frame would call `setActiveIndex`, and even a same-value setState
   * re-runs `renderItem` for every mounted cell — on a video list that is a
   * dropped-frame machine. Now state moves once per page, not once per frame.
   */
  const activeIndexRef = useRef(0);
  const applyActiveIndex = useCallback((next: number) => {
    if (activeIndexRef.current === next) return;
    activeIndexRef.current = next;
    setActiveIndex(next);
  }, []);

  const load = useCallback(async () => {
    if (scope !== 'announcements' && !ids.length) {
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
      let query = supabase
        .from('posts')
        .select(POST_WITH_AUTHOR_AND_COMMUNITY)
        .in('community_id', ids)
        .eq('post_type', 'video')
        .is('deleted_at', null);
      // A non-member may only see the community's public face. RLS says the
      // same thing server-side; this makes the intent readable here too.
      if (scope === 'community-announcements') query = query.eq('posted_as_community', true);

      const { data, error: err } = await query
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

    const startAt = initialReelIndex(rows, initialPostId);
    setReels(rows);
    setInitialIndex(startAt);
    applyActiveIndex(startAt);
    setLoading(false);
  }, [scope, ids, initialPostId, applyActiveIndex]);

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
      if (cursor === null || !ids.length) return;
      setLoadingMore(true);

      let query = supabase
        .from('posts')
        .select(POST_WITH_AUTHOR_AND_COMMUNITY)
        .in('community_id', ids)
        .eq('post_type', 'video')
        .is('deleted_at', null)
        .lt('feed_score', cursor);
      if (scope === 'community-announcements') query = query.eq('posted_as_community', true);

      const { data, error: err } = await query
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
  }, [scope, ids, hasMore, loadingMore]);

  useEffect(() => { void load(); }, [load]);

  /**
   * One video plays at a time, and the threshold is measured against the
   * VIEWPORT, not the item.
   *
   * Both implementations pick their denominator off which key you set —
   * `viewAreaMode ? pixelsVisible / listMainSize : pixelsVisible / itemSize` in
   * flash-list, `viewAreaMode ? pixels / viewportHeight : pixels / itemLength`
   * in React Native. Visible pixels can never exceed the viewport, so under
   * `itemVisiblePercentThreshold` the best score a cell taller than the viewport
   * can ever reach is `viewport / itemSize`: it stops being able to hit 100% the
   * moment it overflows, and it drops under a threshold T once it grows past
   * `viewport ÷ T`. Nothing is then viewable and no video ever plays. Under
   * `viewAreaCoveragePercentThreshold` a cell filling the viewport scores 100%
   * however tall it is, so the config is correct on its own rather than correct
   * only for as long as a cell keeps fitting.
   *
   * Exactly one of the two may be set: flash-list throws
   * `multipleViewabilityThresholdTypesNotSupported` when it sees both.
   *
   * src: https://github.com/Shopify/flash-list/blob/v1.6.4/src/viewability/ViewabilityHelper.ts · @shopify/flash-list 1.6.4 · 2026-08-05
   * src: https://github.com/facebook/react-native/blob/v0.74.5/packages/virtualized-lists/Lists/ViewabilityHelper.js · react-native 0.74.5 · 2026-08-05
   */
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 60 }).current;
  // Must keep a stable identity — FlashList/VirtualizedList throws on a changing
  // onViewableItemsChanged. Safe to close over applyActiveIndex: it is itself
  // stable for the life of the component.
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) applyActiveIndex(first.index);
    },
  ).current;

  /**
   * Viewability alone loses the active index, so the scroll offset backs it up.
   *
   * `minimumViewTime` is not the cleaner replacement it looks like: flash-list
   * already applies one whether or not you ask for it —
   * `const minimumViewTime = this.viewabilityConfig?.minimumViewTime ?? 250`,
   * with the comment "Default of 0 can impact performance when user scrolls
   * fast." So every viewability callback on this list is ALREADY debounced a
   * quarter of a second, which is precisely why a fast flick leaves
   * `activeIndex` on the video the viewer already swept past, its audio playing
   * under the new cell's frame. Raising `minimumViewTime` makes that worse and
   * dropping it to 0 trades it for dropped frames. The scroll offset never lies
   * and costs nothing, so it stays as the fallback.
   *
   * src: https://github.com/Shopify/flash-list/blob/v1.6.4/src/viewability/ViewabilityHelper.ts · @shopify/flash-list 1.6.4 · 2026-08-05
   */
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    applyActiveIndex(activeIndexFromScroll(e.nativeEvent.contentOffset.y, pageH, reels.length));
  }, [pageH, reels.length, applyActiveIndex]);

  /**
   * WHICH POST is active, not merely which slot.
   *
   * A bare index says nothing about what lives there, and it is stale the moment
   * the array shifts — `load` splices a directly-opened video onto the front of
   * the page, and every `loadMore` appends. Cells key their playback off this
   * id; the index is left to do the one job that genuinely is positional, which
   * is measuring distance for the decoder window.
   */
  const activeItemId = reels[activeIndex]?.id ?? null;

  // Marking seen follows activeIndex rather than viewability, so a flick still
  // records what was watched. The ref keeps a re-render from re-upserting.
  const lastSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeItemId || lastSeenRef.current === activeItemId) return;
    lastSeenRef.current = activeItemId;
    markSeen(activeItemId);
  }, [activeItemId, markSeen]);

  // FlashList recycles cells. Without this it has no reason to re-render one
  // when the active video, the mute state, or a like changes, so a recycled cell
  // keeps the previous post's play state and icons.
  const extraData = useMemo(
    () => ({
      activeIndex, activeItemId, muted,
      likedPostIds, savedPostIds, likeCountDeltas, reducedMotion,
    }),
    [
      activeIndex, activeItemId, muted,
      likedPostIds, savedPostIds, likeCountDeltas, reducedMotion,
    ],
  );

  // Exact page size, so FlashList never guesses a cell's height and the snap
  // interval and viewability maths agree with what is on screen.
  const overrideItemLayout = useCallback(
    (layout: { span?: number; size?: number }) => { layout.size = pageH; },
    [pageH],
  );
  /**
   * One recycling pool per post type.
   *
   * "FlashList will now use separate recycling pools based on `item.type`. That
   * means we will never recycle items of different types, making the re-render
   * faster." A single constant collapses every type into one pool, so the moment
   * this pager carries anything but video — the next slice — FlashList would
   * recycle a game cell's view into a video cell and rebuild the whole render
   * tree on every swipe. Keying on `post_type` costs nothing today and is the
   * difference between a smooth mixed feed and a stuttering one.
   *
   * src: https://shopify.github.io/flash-list/docs/1.x/fundamentals/performant-components · @shopify/flash-list 1.6.4 · 2026-08-05
   */
  const getItemType = useCallback((item: ReelRow) => item.post_type, []);

  const s = StyleSheet.create({
    fill: { flex: 1, backgroundColor: '#000' },
    centred: {
      flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12,
      backgroundColor: colors.background,
    },
    errorText: { color: colors.textSecondary, textAlign: 'center' },
    retry: { color: colors.roxy, fontWeight: '700', fontSize: 15 },
  });

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  // The list is measured before it is built: rendering it against an unmeasured
  // page would bake a zero item size into FlashList's layout cache.
  let body: JSX.Element;
  if (loading || pageH <= 0) {
    body = (
      <View style={s.centred}>
        <ActivityIndicator color={colors.roxy} />
      </View>
    );
  } else if (error) {
    body = (
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
    body = (
      <EmptyState
        emoji="🎬"
        title="No videos yet"
        body={EMPTY_BODY[scope]}
      />
    );
  } else {
    body = (
      <FlashList
        data={reels}
        keyExtractor={(item) => item.id}
        extraData={extraData}
        estimatedItemSize={pageH}
        overrideItemLayout={overrideItemLayout}
        getItemType={getItemType}
        // Default is 250dp — under half a page, so the next cell had not been
        // drawn when the swipe landed on it and the viewer got a black frame.
        drawDistance={pageH * 2}
        initialScrollIndex={initialIndex}
        // No `pagingEnabled`: snapToInterval overrides it, and pairing the two
        // on Android with flash-list 1.6.x + RN 0.74 jumps the list to the last
        // index. src: https://github.com/Shopify/flash-list/issues/1200 · @shopify/flash-list 1.6.4 · 2026-08-02
        snapToInterval={pageH}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.6}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        renderItem={({ item, index }) => (
          <ReelCell
            post={item}
            index={index}
            activeIndex={activeIndex}
            activeItemId={activeItemId}
            width={pageW > 0 ? pageW : windowWidth}
            height={pageH}
            muted={muted}
            liked={likedPostIds.has(item.id)}
            saved={savedPostIds.has(item.id)}
            likeCount={displayedLikeCount(item, likeCountDeltas)}
            reducedMotion={reducedMotion}
            onToggleMute={toggleMute}
            onLike={() => void toggleLike(item.id)}
            onSave={() => void toggleSave(item.id)}
            // Video detail lives at /community/video/:id — the old
            // /discover/post/:id route does not render a video post.
            onOpenComments={() => router.push(contentDetailPath(item.id, 'video') as never)}
            onOpenAuthor={() => router.push(`/user/${item.author_id}` as never)}
            onOpenCommunity={() => router.push(`/community/${item.community_id}` as never)}
          />
        )}
      />
    );
  }

  return <View testID="reels-feed" style={s.fill} onLayout={handleLayout}>{body}</View>;
}
