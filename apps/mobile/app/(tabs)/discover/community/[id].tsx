import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Share, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
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
import { ProfileShell } from '../../../../components/profile/ProfileShell';
import type { PopulatedTabs, ProfileTab } from '../../../../components/profile/profileVariant';
import { EventModeBadge, type EventMode } from '../../../../components/events/EventModeBadge';
import { TYPE } from '../../../../lib/typography';
import { RADII, inkOn } from '../../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../../lib/touchTargets';

/**
 * A community on the unified profile shell.
 *
 * The header, the LIVE pill and the strip used to be drawn here — a fifth
 * opinion on cover / avatar / tabs, next to user, seller, business and You.
 * 3.0 draws them once (`ProfileShell`, prototype markup 434–633). This route
 * still owns every query; the shell only owns the frame.
 *
 * Tabs are Rooms · Events · Games · About plus Posts when there is something
 * to show, or when she has joined (so the empty state and the create FAB still
 * have a home). Reels stay reachable as a full-screen watch, not a sixth tab
 * the prototype never drew.
 */


type EventRow = {
  id: string; title: string; starts_at: string; location: string | null;
  description: string | null;
  event_type?: EventMode | null;
};

type CommunityGameRow = {
  id: string; name: string; short_description: string;
  category: string; url: string | null; publisher_type: 'roxy' | 'community';
};

const GAME_CATEGORY_EMOJI: Record<string, string> = {
  dating: '⚡', icebreaker: '💞', party: '🃏', trivia: '🎯', other: '🎮',
};

export default function CommunityDetailScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { joinedIds, allCommunities, joinCommunity, leaveCommunity, fetchAll, fetchJoined } = useCommunityStore();

  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [reelsOpen, setReelsOpen] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState(false);
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
    backBtn: {
      minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center', justifyContent: 'center',
    },

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

    reelsRoot: { flex: 1, backgroundColor: colors.background },
    reelsBar: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 12, paddingVertical: 8,
    },
    reelsTitle: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700', flex: 1 },
    reelsEntry: {
      marginHorizontal: 16, marginBottom: 10,
      minHeight: MIN_TOUCH_TARGET, borderRadius: RADII.md,
      borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    reelsEntryText: { ...TYPE.body, color: colors.primaryInk, fontWeight: '700' },
    aboutWrap: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
    aboutCard: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
      borderRadius: RADII.lg, padding: 14, gap: 8,
    },
    aboutLabel: { ...TYPE.caption, color: colors.textMuted, fontWeight: '800', letterSpacing: 0.8 },
    aboutBody: { ...TYPE.body, color: colors.textSecondary, lineHeight: 20 },
    membersLink: {
      minHeight: MIN_TOUCH_TARGET, justifyContent: 'center',
    },
    membersLinkText: { ...TYPE.body, color: colors.primaryInk, fontWeight: '700' },

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

  const live = rooms.some((r) => r.status === 'live');
  const hasVideo = posts.some((p) => p.post_type === 'video');

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

  const populated: PopulatedTabs = {
    posts: isJoined || posts.length > 0,
    shop: false,
    events: events.length > 0,
    rooms: rooms.length > 0,
    games: communityGames.length > 0,
    about: true,
    saved: false,
  };

  const renderTab = (tab: ProfileTab) => {
    if (tab === 'posts') {
      return (
        <View>
          {isJoined ? null : joinNotice}
          {hasVideo ? (
            <TouchableOpacity
              style={styles.reelsEntry}
              onPress={() => setReelsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Watch ${community.name} reels`}
              testID="community-reels-entry"
            >
              <Text style={styles.reelsEntryText}>Watch reels</Text>
            </TouchableOpacity>
          ) : null}
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
        </View>
      );
    }

    if (tab === 'rooms') {
      if (loadingRooms) return <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />;
      if (rooms.length === 0) {
        return (
          <View style={styles.emptyCenter}>
            <Text style={styles.emptyIcon}>📡</Text>
            <Text style={styles.emptyTitle}>No rooms open right now</Text>
            <Text style={styles.emptySub}>Check back later for live rooms</Text>
          </View>
        );
      }
      return (
        <View style={{ padding: 12, paddingBottom: 80 }}>
          {rooms.map((room) => (
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
          ))}
        </View>
      );
    }

    if (tab === 'games') {
      if (loadingGames) return <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />;
      if (communityGames.length === 0) {
        return (
          <View style={styles.emptyCenter}>
            <Text style={styles.emptyIcon}>🎮</Text>
            <Text style={styles.emptyTitle}>No games yet</Text>
            <Text style={styles.emptySub}>Community admins can enable games here.</Text>
          </View>
        );
      }
      return (
        <View style={styles.gamesContainer}>
          {communityGames.map((game) => {
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
          })}
        </View>
      );
    }

    if (tab === 'events') {
      return (
        <View style={{ paddingTop: 8, paddingBottom: 24 }}>
          <View style={styles.viewToggleRow}>
            {(['list', 'calendar'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.viewToggleBtn, eventsView === v && styles.viewToggleBtnActive]}
                onPress={() => setEventsView(v)}
                accessibilityLabel={v === 'list' ? 'List view' : 'Calendar view'}
              >
                <Ionicons name={v === 'list' ? 'list' : 'calendar'} size={16} color={eventsView === v ? inkOn(colors.roxy) : colors.textMuted} />
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
                      {event.location && <Text style={styles.eventLocation} numberOfLines={1}>{event.location}</Text>}
                      {event.event_type ? (
                        <View style={{ marginTop: 4 }}>
                          <EventModeBadge mode={event.event_type} />
                        </View>
                      ) : null}
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
        </View>
      );
    }

    return (
      <View style={styles.aboutWrap}>
        {community.description ? (
          <Text style={styles.aboutBody}>{community.description}</Text>
        ) : null}
        <View style={styles.aboutCard}>
          <Text style={styles.aboutLabel}>COMMUNITY</Text>
          <Text style={styles.aboutBody}>
            {community.is_private ? 'Private' : 'Public'} · {community.member_count} members
          </Text>
          <Text style={styles.aboutBody}>
            Created {format(new Date(community.created_at), 'MMMM yyyy')}
          </Text>
          <TouchableOpacity
            style={styles.membersLink}
            onPress={() => router.push(`/community/members/${id}` as any)}
            accessibilityRole="button"
            accessibilityLabel={`See members of ${community.name}`}
          >
            <Text style={styles.membersLinkText}>See members</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (reelsOpen) {
    return (
      <SafeAreaView style={styles.reelsRoot} edges={['top']}>
        <View style={styles.reelsBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => setReelsOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close reels"
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.reelsTitle} numberOfLines={1}>{community.name} reels</Text>
        </View>
        <ReelsFeed
          scope={isJoined ? 'community' : 'community-announcements'}
          communityIds={[id]}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="community-shell">
      <ProfileShell
        variant="community"
        name={community.name}
        subtitle={`${community.member_count} members · ${community.is_private ? 'Private' : 'Public'}`}
        bio={community.description}
        coverUrl={community.cover_image_url}
        avatarUrl={community.cover_image_url}
        live={live}
        stats={[
          { value: String(community.member_count), label: 'Members' },
          { value: String(posts.length), label: 'Posts' },
          { value: live ? 'LIVE' : String(rooms.length), label: live ? 'On air' : 'Rooms' },
        ]}
        onBack={handleBack}
        primaryAction={
          isJoined
            ? { label: 'Joined' }
            : { label: 'Join', onPress: handleJoinLeave, accessibilityLabel: `Join ${community.name}` }
        }
        secondaryAction={
          isJoined
            ? {
                label: '# Channels',
                onPress: () => router.push(`/community/channels/${id}` as any),
                accessibilityLabel: `Open ${community.name} channels`,
                testID: 'community-channels-link',
              }
            : undefined
        }
        populated={populated}
        renderTab={renderTab}
        testID="profile-shell"
      />
      {isJoined ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push({ pathname: '/community/create-post', params: { communityId: id } } as any)}
          accessibilityRole="button"
          accessibilityLabel="Create a post"
        >
          <Ionicons name="add" size={28} color={inkOn(colors.primary)} />
        </TouchableOpacity>
      ) : null}
    </SafeAreaView>
  );
}

