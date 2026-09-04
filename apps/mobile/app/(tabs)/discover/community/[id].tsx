import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Share, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, usePathname } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useCommunityStore, Community } from '../../../../store/communityStore';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { logError } from '../../../../lib/errorLogger';
import { Analytics } from '../../../../lib/analytics';
import { showAlert } from '../../../../lib/confirm';
import { CommunityRoomCard } from '../../../../components/community/CommunityRoomCard';
import { CommunityRoom, Post } from '../../../../types';
import { FeedCard } from '../../../../components/feed/FeedCard';
import { ReelsFeed } from '../../../../components/feed/ReelsFeed';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { useFeedStore } from '../../../../store/feedStore';
import { normalizePost } from '../../../../lib/posts';
import { contentDetailPath, linkedEntityPath } from '../../../../lib/contentNavigation';
import { isPlayableGameUrl } from '../../../../lib/gameUrl';
import { POST_WITH_AUTHOR_AND_COMMUNITY } from '../../../../lib/supabaseQueries';
import { EventsCalendar } from '../../../../components/events/EventsCalendar';
import { freshChannel } from '../../../../lib/realtimeChannel';
import { useAppWidth } from '../../../../hooks/useAppWidth';

/**
 * Inside a community is where member content lives — this is the "what's going
 * on inside" half of the product, and joining is what unlocks it. Connect
 * carries the other half: announcements, which are public by design.
 *
 * Both content formats therefore exist twice, at two different scopes. Posts
 * and Reels here are the community's own; the same two tabs in Connect are the
 * public square.
 */
type SubTab = 'posts' | 'reels' | 'events' | 'games' | 'rooms';

const TABS: SubTab[] = ['posts', 'reels', 'rooms', 'games', 'events'];


type EventRow = {
  id: string; title: string; starts_at: string; location: string | null;
  description: string | null;
};

type CommunityGameRow = {
  id: string; name: string; short_description: string;
  category: string; url: string | null; publisher_type: 'roxy' | 'community';
};

const GAME_CATEGORY_EMOJI: Record<string, string> = {
  dating: '⚡', icebreaker: '💞', party: '🃏', trivia: '🎯', other: '🎮',
};

function getCommunityLevel(n: number): { label: string; emoji: string } {
  if (n >= 100) return { label: 'Radiant', emoji: '✨' };
  if (n >= 20) return { label: 'Thriving', emoji: '🌸' };
  if (n >= 5) return { label: 'Growing', emoji: '🌿' };
  return { label: 'Seedling', emoji: '🌱' };
}

export default function CommunityDetailScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const screenWidth = useAppWidth();
  const { user } = useAuthStore();
  const { joinedIds, allCommunities, joinCommunity, leaveCommunity, fetchAll, fetchJoined } = useCommunityStore();

  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<SubTab>('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState(false);
  /**
   * The pager's own viewport, measured. The reels list sizes each page to the
   * box it is given, and a horizontal pager page has no intrinsic height to
   * hand it — an unmeasured page would leave the video list waiting on a
   * layout that never arrives.
   */
  const [pagerHeight, setPagerHeight] = useState(0);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsView, setEventsView] = useState<'list' | 'calendar'>('list');
  const [rsvpIds, setRsvpIds] = useState<Set<string>>(new Set());
  const {
    likedPostIds, savedPostIds,
    init: initFeed, toggleLike: feedToggleLike, toggleSave,
  } = useFeedStore();
  const [rooms, setRooms] = useState<(CommunityRoom & { creator_display_name: string | null })[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [communityGames, setCommunityGames] = useState<CommunityGameRow[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);

  // Track screen view once per navigation
  useEffect(() => {
    if (id) Analytics.communityViewed(id);
  }, [id]);

  // Load community data
  useEffect(() => {
    if (!id) return;
    // Try store first
    const found = allCommunities.find((c) => c.id === id);
    if (found) {
      setCommunity(found);
      setLoading(false);
    } else {
      supabase.from('communities').select('*').eq('id', id).single().then(({ data }) => {
        if (data) setCommunity(data as Community);
        setLoading(false);
      });
    }
  }, [id, allCommunities]);

  const isJoined = id ? joinedIds.has(id) : false;

  /**
   * Same query + normalizer as the rest of the app — one post pipeline.
   *
   * A member sees everything. A non-member sees the community's public face
   * only: its announcements. `posts_select` (migration 073) already draws that
   * line server-side — `posted_as_community = true OR is_community_member(...)`
   * — so this filter is not what protects the content. It is here so the screen
   * asks for exactly what it is entitled to, and so the empty state below can
   * tell the truth about why a tab is short.
   */
  const loadPosts = useCallback(async () => {
    if (!id) return;
    setPostsLoading(true);
    setPostsError(false);
    let query = supabase
      .from('posts')
      .select(POST_WITH_AUTHOR_AND_COMMUNITY)
      .eq('community_id', id)
      .is('deleted_at', null);
    if (!isJoined) query = query.eq('posted_as_community', true);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) {
      logError(error, 'community.loadPosts');
      setPostsError(true);
      setPosts([]);
    } else {
      setPosts((data as Record<string, unknown>[]).map(normalizePost));
    }
    setPostsLoading(false);
  }, [id, isJoined]);

  const loadEvents = useCallback(async () => {
    if (!id) return;
    const now = new Date().toISOString();
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('community_id', id)
      .gte('starts_at', now)
      .order('starts_at');
    if (data) setEvents(data as EventRow[]);
  }, [id]);

  const loadRooms = useCallback(async () => {
    if (!id) return;
    setLoadingRooms(true);
    const { data } = await supabase
      .from('community_rooms')
      .select('*, profiles!created_by(display_name)')
      .eq('community_id', id)
      .neq('status', 'closed')
      .eq('is_active', true)
      .order('name');
    if (data) {
      setRooms(data.map((r: any) => ({
        ...r,
        creator_display_name: r.profiles?.display_name ?? null,
        participant_count:    r.participant_count ?? 0,
        max_participants:     r.max_participants ?? null,
      })));
    }
    setLoadingRooms(false);
  }, [id]);

  const loadRsvps = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('event_attendees')
      .select('event_id')
      .eq('user_id', user.id);
    if (data) setRsvpIds(new Set(data.map((r: any) => r.event_id)));
  }, [user]);

  useEffect(() => {
    if (user?.id) void initFeed(user.id);
  }, [user?.id, initFeed]);

  const loadGames = useCallback(async () => {
    if (!id) return;
    setLoadingGames(true);
    const { data } = await supabase
      .from('community_games')
      .select('games(id, name, short_description, category, url, publisher_type)')
      .eq('community_id', id);
    if (data) {
      setCommunityGames(
        (data as any[]).map((row) => row.games).filter(Boolean) as CommunityGameRow[],
      );
    }
    setLoadingGames(false);
  }, [id]);

  // Load all tab content upfront so swiping is instant.
  //
  // `isJoined` belongs in here: joining changes what every one of these queries
  // is allowed to return, so without it the screen keeps showing the
  // non-member's view of a community she just joined until she navigates away
  // and back.
  useEffect(() => {
    loadPosts();
    loadEvents();
    loadRsvps();
    loadRooms();
    loadGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isJoined]);

  // Bug fix: publishing a post (or RSVPing to an event) from a screen pushed
  // on top of this one returned here with no refetch — the new content
  // looked like it never posted. Native: this screen stays mounted in the
  // stack, so useFocusEffect fires on return. Web: useFocusEffect does NOT
  // fire on web navigation via the root Stack (see connect/index.tsx for the
  // same caveat), so fall back to a pathname-change effect there.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return;
      loadPosts();
      loadEvents();
      loadRsvps();
    }, [loadPosts, loadEvents, loadRsvps])
  );

  const pathname = usePathname();
  const prevPathnameRef = useRef('');
  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;
    if (Platform.OS !== 'web' || !prev || prev === pathname) return;
    loadPosts();
    loadEvents();
    loadRsvps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!id) return;
    // Realtime: keep participant_count and status live while on this screen
    const channel = freshChannel(`community-rooms-${id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'community_rooms',
        filter: `community_id=eq.${id}`,
      }, (payload) => {
        const updated = payload.new as any;
        setRooms(prev => prev.map(r =>
          r.id === updated.id
            ? { ...r, participant_count: updated.participant_count ?? r.participant_count, status: updated.status ?? r.status }
            : r
        ));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadPosts, loadEvents, loadRsvps, loadRooms, loadGames, id]);

  const pagerRef = useRef<ScrollView>(null);

  const handleTabPress = (tab: SubTab) => {
    const index = TABS.indexOf(tab);
    setSubTab(tab);
    pagerRef.current?.scrollTo({ x: index * screenWidth, animated: true });
  };

  const handleJoinLeave = async () => {
    if (!user || !id) return;
    try {
      if (isJoined) {
        await leaveCommunity(id, user.id);
      } else {
        await joinCommunity(id, user.id);
        Analytics.communityJoined(id);
      }
      await fetchJoined(user.id);
      await fetchAll();
    } catch (e: any) {
      logError(e, 'handleJoinLeave');
      showAlert('Error', e?.message ?? 'Could not update membership');
    }
  };

  const toggleRsvp = async (eventId: string) => {
    if (!user) return;
    if (rsvpIds.has(eventId)) {
      await supabase.from('event_attendees').delete().eq('event_id', eventId).eq('user_id', user.id);
      setRsvpIds((prev) => { const n = new Set(prev); n.delete(eventId); return n; });
    } else {
      await supabase.from('event_attendees').insert({ event_id: eventId, user_id: user.id, status: 'going' });
      setRsvpIds((prev) => new Set([...prev, eventId]));
    }
  };


  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },

    // Compact header — no decorative banner, content starts right after this
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10,
      backgroundColor: colors.surface,
    },
    backBtn: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    avatarWrap: {
      width: 40, height: 40, borderRadius: 20, flexShrink: 0,
      backgroundColor: colors.secondary + '30',
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    avatarImg: { width: 40, height: 40 },
    avatarEmoji: { fontSize: 18 },

    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    communityName: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', flexShrink: 1 },
    levelBadge: {
      backgroundColor: colors.secondary + '20', borderRadius: 10,
      paddingHorizontal: 8, paddingVertical: 2,
    },
    levelBadgeText: { color: colors.secondary, fontWeight: '700', fontSize: 11 },
    livePill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.error + '20', borderRadius: 10,
      paddingHorizontal: 8, paddingVertical: 2,
    },
    livePillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error },
    chatPill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.primary + '20', borderRadius: 10,
      paddingHorizontal: 8, paddingVertical: 2,
    },
    chatPillText: { color: colors.primaryInk, fontWeight: '700', fontSize: 11 },
    livePillText: { color: colors.error, fontWeight: '700', fontSize: 11 },
    membersRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    membersText: { color: colors.textMuted, fontWeight: '600', fontSize: 12 },
    privacyPill: {
      backgroundColor: colors.primary + '20', borderRadius: 8,
      paddingHorizontal: 7, paddingVertical: 1,
    },
    privacyPillPrivate: { backgroundColor: colors.textMuted + '20' },
    privacyPillText: { color: colors.textMuted, fontSize: 10 },
    communityDescInline: { color: colors.textMuted, fontSize: 12, flexShrink: 1 },
    joinBtnCompact: {
      backgroundColor: colors.roxy, borderRadius: 14,
      paddingHorizontal: 14, paddingVertical: 7, flexShrink: 0,
    },
    joinBtnJoined: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.textMuted + '60' },
    joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
    joinBtnTextJoined: { color: colors.textMuted },

    // Sub-tabs
    subTabRow: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    subTab: {
      flex: 1, paddingVertical: 13,
      alignItems: 'center',
      borderBottomWidth: 2, borderBottomColor: 'transparent',
    },
    subTabActive: { borderBottomColor: colors.roxy },
    subTabText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    subTabTextActive: { color: colors.roxy, fontWeight: '700' },

    // Events
    eventCardBody: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    viewToggleRow: {
      flexDirection: 'row', gap: 6, justifyContent: 'flex-end',
      paddingHorizontal: 14, marginBottom: 6,
    },
    viewToggleBtn: {
      width: 34, height: 30, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    viewToggleBtnActive: { backgroundColor: colors.roxy },
    eventCard: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.surface, marginHorizontal: 12, marginBottom: 8,
      borderRadius: 12, padding: 10,
    },
    dateChip: {
      width: 36, alignItems: 'center', backgroundColor: colors.primary + '20',
      borderRadius: 8, paddingVertical: 4,
    },
    dateDay: { color: colors.textPrimary, fontWeight: '800', fontSize: 14 },
    dateMonth: { color: colors.textMuted, fontSize: 10 },
    eventTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 13, marginBottom: 2 },
    eventLocation: { color: colors.textSecondary, fontSize: 11 },
    rsvpBtn: {
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
      borderWidth: 1, borderColor: colors.primary,
    },
    rsvpBtnGoing: { backgroundColor: colors.primary, borderColor: colors.primary },
    rsvpBtnText: { color: colors.primary, fontWeight: '700', fontSize: 11 },
    rsvpBtnTextGoing: { color: '#fff' },

    // Games
    gamesContainer: { padding: 12, gap: 8 },
    gameCard: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.surface, borderRadius: 12, padding: 12,
    },
    gameEmoji: { fontSize: 24 },
    gameTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14, marginBottom: 2 },
    gameDesc: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
    playBtn: {
      backgroundColor: colors.roxy, borderRadius: 16,
      paddingHorizontal: 12, paddingVertical: 6,
    },
    playBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },

    // FAB
    fab: {
      position: 'absolute', bottom: 24, right: 20,
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3, shadowRadius: 6, elevation: 8,
    },

    // Non-member notice — a community's public face, and the way in
    joinNotice: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.secondary + '18',
      borderRadius: 14, marginHorizontal: 12, marginBottom: 10, padding: 12,
    },
    joinNoticeEmoji: { fontSize: 20 },
    joinNoticeTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 13.5, marginBottom: 2 },
    joinNoticeText: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 17 },
    joinNoticeBtn: {
      backgroundColor: colors.roxy, borderRadius: 16, paddingHorizontal: 14,
      minHeight: 34, alignItems: 'center', justifyContent: 'center',
    },
    joinNoticeBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },

    // Reels page — the pager gives it an explicit box; ReelsFeed measures it
    reelsPage: { backgroundColor: colors.background },

    // Error / empty
    errorText: { color: colors.textMuted, textAlign: 'center', marginTop: 48, fontSize: 16 },
    retryLink: { color: colors.roxy, fontWeight: '700', fontSize: 15 },
    emptyCenter: { alignItems: 'center', padding: 40, gap: 12 },
    emptyIcon: { fontSize: 48 },
    emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
    emptySub: { color: colors.textSecondary, textAlign: 'center' },
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
      </SafeAreaView>
    );
  }

  // Cold deep links (shared URL, new tab) have no history — back must still
  // land somewhere sensible instead of doing nothing on web.
  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/(tabs)/discover', params: {} } as any);
  };

  if (!community) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.errorText}>Community not found</Text>
      </SafeAreaView>
    );
  }

  const level = getCommunityLevel(community.member_count);

  /**
   * What a non-member gets instead of member content: the community's public
   * face, named as such, with the door held open. Not a blank tab, not an
   * error, and never a silent trim of the list she is looking at.
   */
  const joinNotice = (
    <View style={styles.joinNotice}>
      <Text style={styles.joinNoticeEmoji}>🌸</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.joinNoticeTitle}>You&apos;re seeing the public side</Text>
        <Text style={styles.joinNoticeText}>
          Announcements are open to everyone. Join to see what members are sharing inside.
        </Text>
      </View>
      <TouchableOpacity
        style={styles.joinNoticeBtn}
        onPress={handleJoinLeave}
        accessibilityRole="button"
        accessibilityLabel={`Join ${community.name}`}
      >
        <Text style={styles.joinNoticeBtnText}>Join</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* Compact header — content starts almost immediately, no decorative banner */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.avatarWrap}>
          {community.cover_image_url ? (
            <Image source={{ uri: community.cover_image_url }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarEmoji}>{level.emoji}</Text>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <View style={styles.infoRow}>
            <Text style={styles.communityName} numberOfLines={1}>{community.name}</Text>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeText}>{level.emoji} {level.label}</Text>
            </View>
            {rooms.some((r) => r.status === 'live') && (
              <TouchableOpacity style={styles.livePill} onPress={() => handleTabPress('rooms')}>
                <View style={styles.livePillDot} />
                <Text style={styles.livePillText}>Live</Text>
              </TouchableOpacity>
            )}
            {/* Channels are a full-screen route, not a page of this pager, so
                they get an entry point here rather than a sixth sub-tab.
                Members only: migration 105's RLS returns nothing to anyone
                else, and sending her to an empty screen that explains why is a
                dead end dressed up as a feature. */}
            {isJoined && (
              <TouchableOpacity
                style={styles.chatPill}
                onPress={() => router.push(`/community/channels/${id}` as any)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${community.name} channels`}
                testID="community-channels-link"
              >
                <Text style={styles.chatPillText}># Chat</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            onPress={() => router.push(`/community/members/${id}` as any)}
            style={styles.membersRow}
          >
            <Text style={styles.membersText}>{community.member_count} members</Text>
            <View style={[styles.privacyPill, community.is_private && styles.privacyPillPrivate]}>
              <Text style={styles.privacyPillText}>{community.is_private ? '🔒 Private' : '🌐 Public'}</Text>
            </View>
            {community.description ? (
              <Text style={styles.communityDescInline} numberOfLines={1}> · {community.description}</Text>
            ) : null}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.joinBtnCompact, isJoined && styles.joinBtnJoined]}
          onPress={handleJoinLeave}
        >
          <Text style={[styles.joinBtnText, isJoined && styles.joinBtnTextJoined]}>
            {isJoined ? 'Joined' : 'Join'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={styles.subTabRow}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.subTab, subTab === tab && styles.subTabActive]}
            onPress={() => handleTabPress(tab)}
          >
            <Text style={[styles.subTabText, subTab === tab && styles.subTabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Horizontal pager */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
        onLayout={(e) => setPagerHeight(e.nativeEvent.layout.height)}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
          setSubTab(TABS[index]);
        }}
      >
        {/* Page 0 — Posts (shared FeedCard pipeline — identical to Connect feed) */}
        <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ paddingTop: 8, paddingBottom: 80 }}>
          {isJoined ? null : joinNotice}
          {postsLoading ? (
            <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
          ) : postsError ? (
            <View style={styles.emptyCenter}>
              <Text style={styles.emptyIcon}>📡</Text>
              <Text style={styles.emptyTitle}>Could not load posts</Text>
              <TouchableOpacity
                onPress={() => void loadPosts()}
                accessibilityRole="button"
                accessibilityLabel="Try loading posts again"
              >
                <Text style={styles.retryLink}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : posts.length === 0 ? (
            <EmptyState
              emoji="📝"
              title={isJoined ? 'No posts yet' : 'No announcements yet'}
              body={isJoined
                ? 'Be the first to post!'
                : `${community.name} hasn't posted publicly yet. Join to see what members are sharing inside.`}
            />
          ) : (
            posts.map((post) => (
              <FeedCard
                key={post.id}
                post={post}
                onLinkPress={() => {
                  void linkedEntityPath(post).then((path) => {
                    router.push((path ?? contentDetailPath(post.id, post.post_type)) as any);
                  });
                }}
                onAuthorPress={() => router.push(`/user/${post.author_id}` as any)}
                isLiked={likedPostIds.has(post.id)}
                isSaved={savedPostIds.has(post.id)}
                onLike={() => void feedToggleLike(post.id)}
                onSave={() => void toggleSave(post.id)}
                onComment={() => router.push(contentDetailPath(post.id, post.post_type) as any)}
                onShare={() => void Share.share({ message: 'Check this out on Roxy!' })}
                onPress={() => router.push(contentDetailPath(post.id, post.post_type) as any)}
              />
            ))
          )}
        </ScrollView>

        {/* Page 1 — Reels: this community's video.
            Mounted only while its tab is active. A vertical video list mounted
            off-screen in a pager still autoplays, so leaving it permanently
            mounted means audio from a tab she is not looking at. */}
        <View style={[styles.reelsPage, { width: screenWidth, height: pagerHeight || undefined }]}>
          {isJoined ? null : joinNotice}
          {subTab === 'reels' ? (
            <ReelsFeed
              scope={isJoined ? 'community' : 'community-announcements'}
              communityIds={[id]}
            />
          ) : null}
        </View>

        {/* Page 2 — Rooms */}
        <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ padding: 12, paddingBottom: 80 }}>
          {loadingRooms ? (
            <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
          ) : rooms.length === 0 ? (
            <View style={styles.emptyCenter}>
              <Text style={styles.emptyIcon}>📡</Text>
              <Text style={styles.emptyTitle}>No rooms open right now</Text>
              <Text style={styles.emptySub}>Check back later for live rooms</Text>
            </View>
          ) : (
            rooms.map((room) => (
              <CommunityRoomCard
                key={room.id}
                id={room.id}
                name={room.name}
                description={room.description}
                room_type={room.room_type}
                status={room.status}
                scheduled_at={room.scheduled_at}
                banner_url={(room as { banner_url?: string | null }).banner_url ?? null}
                community_name={null}
                creator_display_name={room.creator_display_name}
                participant_count={room.participant_count}
                max_participants={room.max_participants}
                hideCommunityTag={true}
                onPress={() => router.push(`/community-room-session?room_id=${room.id}` as any)}
              />
            ))
          )}
        </ScrollView>

        {/* Page 3 — Games (real data from community_games + games tables) */}
        <ScrollView style={{ width: screenWidth }} contentContainerStyle={styles.gamesContainer}>
          {loadingGames ? (
            <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
          ) : communityGames.length === 0 ? (
            <View style={styles.emptyCenter}>
              <Text style={styles.emptyIcon}>🎮</Text>
              <Text style={styles.emptyTitle}>No games yet</Text>
              <Text style={styles.emptySub}>Community admins can enable games here.</Text>
            </View>
          ) : (
            communityGames.map((game) => {
              // `games.url` is an external https address, not a route: pushing it into
              // expo-router dead-ended. Hosted games open in the WebView launch route.
              const isSpeedDating = game.name === 'Speed Dating';
              const canPlay = isSpeedDating || isPlayableGameUrl(game.url);
              return (
                <TouchableOpacity
                  key={game.id}
                  style={styles.gameCard}
                  onPress={() => {
                    if (isSpeedDating) { router.push('/speed-dating' as any); return; }
                    if (canPlay) router.push(`/(tabs)/discover/games/${game.id}` as never);
                  }}
                  disabled={!canPlay}
                  activeOpacity={canPlay ? 0.8 : 1}
                >
                  <Text style={styles.gameEmoji}>
                    {GAME_CATEGORY_EMOJI[game.category] ?? '🎮'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gameTitle}>{game.name}</Text>
                    <Text style={styles.gameDesc}>{game.short_description}</Text>
                  </View>
                  {game.publisher_type === 'roxy' && (
                    <Text style={{ fontSize: 10, color: colors.roxy, fontWeight: '700', marginRight: 6 }}>
                      Roxy Original
                    </Text>
                  )}
                  {canPlay && (
                    <View style={styles.playBtn}>
                      <Text style={styles.playBtnText}>Play</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>

        {/* Page 4 — Events */}
        <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}>
          <View style={styles.viewToggleRow}>
            {(['list', 'calendar'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.viewToggleBtn, eventsView === v && styles.viewToggleBtnActive]}
                onPress={() => setEventsView(v)}
                accessibilityLabel={v === 'list' ? 'List view' : 'Calendar view'}
              >
                <Ionicons name={v === 'list' ? 'list' : 'calendar'} size={16} color={eventsView === v ? '#fff' : colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
          {eventsView === 'calendar' ? (
            <EventsCalendar
              events={events.map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, subtitle: e.location }))}
              onEventPress={(eventId) => router.push(`/event/${eventId}` as any)}
            />
          ) : events.length === 0 ? (
            <View style={styles.emptyCenter}>
              <Text style={styles.emptyIcon}>🗓️</Text>
              <Text style={styles.emptyTitle}>No upcoming events</Text>
            </View>
          ) : (
            events.map((event) => {
              const going = rsvpIds.has(event.id);
              return (
                <View key={event.id} style={styles.eventCard}>
                  {/* Tappable body → event detail; RSVP stays a separate target */}
                  <TouchableOpacity
                    style={styles.eventCardBody}
                    onPress={() => router.push(`/event/${event.id}` as any)}
                    activeOpacity={0.75}
                    accessibilityLabel={`Open event ${event.title}`}
                  >
                    <View style={styles.dateChip}>
                      <Text style={styles.dateDay}>{format(new Date(event.starts_at), 'dd')}</Text>
                      <Text style={styles.dateMonth}>{format(new Date(event.starts_at), 'MMM')}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                      {event.location && <Text style={styles.eventLocation} numberOfLines={1}>📍 {event.location}</Text>}
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rsvpBtn, going && styles.rsvpBtnGoing]}
                    onPress={() => toggleRsvp(event.id)}
                  >
                    <Text style={[styles.rsvpBtnText, going && styles.rsvpBtnTextGoing]}>
                      {going ? 'Going ✓' : 'RSVP'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      </ScrollView>

      {/* FAB — create post (posts tab only) */}
      {subTab === 'posts' && isJoined && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push({ pathname: '/community/create-post', params: { communityId: id } } as any)}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

    </SafeAreaView>
  );
}

