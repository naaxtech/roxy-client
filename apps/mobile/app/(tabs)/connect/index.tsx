import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator, Animated, ScrollView, Share, Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useCommunityStore } from '../../../store/communityStore';
import { useFeedStore } from '../../../store/feedStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { GAME_ROUTES } from '../../../lib/games';
import { logError } from '../../../lib/errorLogger';
import { normalizePost } from '../../../lib/posts';
import { contentDetailPath } from '../../../lib/contentNavigation';
import { POST_WITH_AUTHOR_AND_COMMUNITY } from '../../../lib/supabaseQueries';
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';
import { CommunityRoomCard } from '../../../components/community/CommunityRoomCard';
import { FeedCard } from '../../../components/feed/FeedCard';
import type { Post } from '../../../types';


type SubTab = 'feed' | 'events' | 'rooms';

type PostRow = Post & {
  communities: { name: string } | null;
};

type EventRow = {
  id: string; title: string; starts_at: string; ends_at: string | null;
  location_text: string | null; community_id: string;
  is_paid: boolean; communities: { name: string } | null;
};

type GameRow = {
  id: string; slug: string; name: string; description: string | null;
  emoji: string; is_active: boolean;
};

type CommunityRoomRow = {
  id: string; name: string; description: string | null;
  room_type: 'video' | 'audio'; status: 'live' | 'scheduled' | 'closed';
  scheduled_at: string | null; community_id: string;
  communities: { name: string } | null;
  creator_display_name: string | null; is_active: boolean;
};


export default function ConnectScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile, setProfile } = useProfileStore();
  const { joinedIds, joinedCommunities, hydrated, hydrate } = useCommunityStore();
  const { selectedCommunityId } = useCommunityFilterStore();
  const {
    likedPostIds, savedPostIds, connectScrollOffset,
    init: initFeed, toggleLike, toggleSave, setConnectScrollOffset,
  } = useFeedStore();
  const colors = useThemeColors();

  const feedListRef = useRef<FlashList<PostRow>>(null);
  // Tracks live scroll position without touching Zustand on every frame —
  // writing to the store on each onScroll re-renders this screen mid-gesture and causes stutter.
  const scrollOffsetRef = useRef(connectScrollOffset);

  const [subTab, setSubTab] = useState<SubTab>('feed');
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const switchTab = (tab: SubTab) => {
    fadeAnim.setValue(0);
    setSubTab(tab);
    Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  };

  const [posts, setPosts] = useState<PostRow[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [gameNames, setGameNames] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<EventRow[]>([]);
  const [rsvpIds, setRsvpIds] = useState<Set<string>>(new Set());
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [datingMode, setDatingMode] = useState(profile?.is_dating_mode ?? false);

  const [games, setGames] = useState<GameRow[]>([]);
  const [rooms, setRooms] = useState<CommunityRoomRow[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  const joinedIdsKey = useMemo(() => Array.from(joinedIds).sort().join(','), [joinedIds]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    headerTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },

    // Sub-tabs — underline style
    subTabRow: {
      flexDirection: 'row',
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    subTab: {
      flex: 1, paddingVertical: 10,
      alignItems: 'center',
      borderBottomWidth: 2, borderBottomColor: 'transparent',
    },
    subTabActive: { borderBottomColor: colors.roxy },
    subTabText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    subTabTextActive: { color: colors.roxy, fontWeight: '700' },

    postMetaRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 16, paddingTop: 4,
    },
    communityPill: {
      backgroundColor: colors.primary + '30', borderRadius: 10,
      paddingHorizontal: 8, paddingVertical: 2,
    },
    communityPillText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
    postTime: { color: colors.textMuted, fontSize: 11 },

    // Events
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
    eventCommunity: { color: colors.textMuted, fontSize: 11, marginBottom: 2 },
    eventLocation: { color: colors.textSecondary, fontSize: 11 },
    eventCardBody: {
      flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1,
    },
    rsvpBtn: {
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
      borderWidth: 1, borderColor: colors.primary,
    },
    rsvpBtnGoing: { backgroundColor: colors.primary, borderColor: colors.primary },
    rsvpBtnText: { color: colors.primary, fontWeight: '700', fontSize: 11 },
    rsvpBtnTextGoing: { color: '#fff' },

    // Rooms (dating toggle + speed date banner carried over)
    datingToggleRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    datingLabel: { color: colors.textSecondary, fontSize: 13 },
    speedDateBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.primary + '20',
      borderBottomWidth: 1, borderBottomColor: colors.primary + '40',
      paddingHorizontal: 16, paddingVertical: 10,
    },
    speedDateIcon: { fontSize: 22 },
    speedDateTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    speedDateSub: { color: colors.textSecondary, fontSize: 12 },
    speedDateArrow: { color: colors.textMuted, fontSize: 20 },

    // Games + Community Rooms
    roomSection: { paddingHorizontal: 12, marginBottom: 8, marginTop: 8 },
    roomSectionTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 15, marginBottom: 8 },
    roomEmpty: { color: colors.textMuted, fontSize: 13, paddingVertical: 8 },
    gameCard: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 6,
    },
    gameEmoji: { fontSize: 24 },
    gameName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    gameDesc: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
    gameArrow: { color: colors.textMuted, fontSize: 20 },
    // Empty states
    emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
    emptyIcon: { fontSize: 48 },
    emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
    emptySub: { color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
    emptyCTA: { backgroundColor: colors.roxy, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10 },
    emptyCTAText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  });

  // Web: pathname changes are reliable (URL-based). useFocusEffect does NOT
  // fire on web when navigating via the root Stack (e.g. to /community/post/*).
  const pathname = usePathname();
  const prevPathnameRef = useRef('');
  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;
    if (!prev.startsWith('/community/') || connectScrollOffset <= 0) return;
    let attempts = 0;
    const tryRestore = () => {
      if (feedListRef.current) {
        feedListRef.current.scrollToOffset({ offset: connectScrollOffset, animated: false });
      } else if (++attempts < 8) {
        setTimeout(tryRestore, 100);
      }
    };
    setTimeout(tryRestore, 80);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Native: useFocusEffect IS reliable — screen stays mounted in the stack.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web' || connectScrollOffset <= 0) return;
      const t = setTimeout(() => {
        feedListRef.current?.scrollToOffset({ offset: connectScrollOffset, animated: false });
      }, 80);
      return () => clearTimeout(t);
    }, [connectScrollOffset])
  );

  useEffect(() => {
    void hydrate(user?.id);
  }, [user?.id, hydrate]);

  useEffect(() => {
    if (user?.id) void initFeed(user.id);
  }, [user?.id, initFeed]);

  useEffect(() => {
    void supabase.from('games').select('id, name').then(({ data }) => {
      if (data) {
        setGameNames(Object.fromEntries(data.map((g) => [g.id, g.name])));
      }
    });
  }, []);

  // Connect → Feed: posts from joined communities; filter via CommunityContextSwitcher (spec 2026-04-07)
  const loadFeed = useCallback(async () => {
    if (!hydrated) return;
    const ids = Array.from(joinedIds);
    if (ids.length === 0) {
      setPosts([]);
      setFeedError(null);
      return;
    }
    setLoadingFeed(true);
    setFeedError(null);
    let query = supabase
      .from('posts')
      .select(POST_WITH_AUTHOR_AND_COMMUNITY)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50);
    if (selectedCommunityId) {
      query = query.eq('community_id', selectedCommunityId);
    } else {
      query = query.in('community_id', ids);
    }
    const { data, error } = await query;
    if (error) {
      logError(error, 'connect.loadFeed');
      setFeedError(error.message);
      setPosts([]);
    } else {
      setPosts(
        (data ?? []).map((row: Record<string, unknown> & { communities?: { name: string } | null }) => ({
          ...normalizePost(row),
          communities: row.communities ?? null,
        })),
      );
    }
    setLoadingFeed(false);
  }, [hydrated, joinedIdsKey, selectedCommunityId, joinedIds]);

  // Load upcoming events from joined communities
  const loadEvents = useCallback(async () => {
    const ids = Array.from(joinedIds);
    if (ids.length === 0) { setEvents([]); return; }
    setLoadingEvents(true);
    const now = new Date().toISOString();
    let query = supabase
      .from('events')
      .select('*, communities(name)')
      .gte('starts_at', now)
      .order('starts_at')
      .limit(20);
    if (selectedCommunityId) {
      query = query.eq('community_id', selectedCommunityId);
    } else {
      query = query.in('community_id', ids);
    }
    const { data } = await query;
    if (data) setEvents(data as EventRow[]);
    setLoadingEvents(false);
  }, [joinedIds, selectedCommunityId]);

  // Load games and community rooms
  const loadRooms = useCallback(async () => {
    setLoadingRooms(true);
    let roomsQuery = supabase
      .from('community_rooms')
      .select('id, name, description, room_type, status, scheduled_at, community_id, communities(name), profiles!created_by(display_name), is_active')
      .neq('status', 'closed')
      .eq('is_active', true)
      .order('name');
    if (selectedCommunityId) {
      roomsQuery = roomsQuery.eq('community_id', selectedCommunityId);
    }
    const [{ data: gamesData }, { data: roomsData }] = await Promise.all([
      supabase.from('games').select('*').eq('is_active', true).order('name'),
      roomsQuery,
    ]);
    if (gamesData) setGames(gamesData as GameRow[]);
    if (roomsData) setRooms(roomsData.map((r: any) => ({
      ...r,
      creator_display_name: r.profiles?.display_name ?? null,
    })) as CommunityRoomRow[]);
    setLoadingRooms(false);
  }, [selectedCommunityId]);

  // Load RSVPs
  const loadRsvps = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('event_attendees')
      .select('event_id')
      .eq('user_id', user.id);
    if (data) setRsvpIds(new Set(data.map((r: any) => r.event_id)));
  }, [user]);

  useEffect(() => {
    if (subTab === 'feed' && hydrated) void loadFeed();
  }, [subTab, loadFeed, hydrated]);
  useEffect(() => { if (subTab === 'events') { loadEvents(); loadRsvps(); } }, [subTab, loadEvents, loadRsvps]);
  useEffect(() => { if (subTab === 'rooms') loadRooms(); }, [subTab, loadRooms]);

  const toggleRsvp = async (eventId: string) => {
    if (!user) return;
    const wasGoing = rsvpIds.has(eventId);

    // Optimistic update — UI reflects instantly
    if (wasGoing) {
      setRsvpIds((prev) => { const n = new Set(prev); n.delete(eventId); return n; });
    } else {
      setRsvpIds((prev) => new Set([...prev, eventId]));
    }

    const { error } = wasGoing
      ? await supabase.from('event_attendees').delete().eq('event_id', eventId).eq('user_id', user.id)
      : await supabase.from('event_attendees').insert({ event_id: eventId, user_id: user.id, status: 'going' });

    if (error) {
      // Revert on failure
      if (wasGoing) {
        setRsvpIds((prev) => new Set([...prev, eventId]));
      } else {
        setRsvpIds((prev) => { const n = new Set(prev); n.delete(eventId); return n; });
      }
    }
  };

  const toggleDatingMode = async (val: boolean) => {
    if (!user) return;
    setDatingMode(val);
    await supabase.from('profiles').update({ is_dating_mode: val }).eq('id', user.id);
    if (profile) setProfile({ ...profile, is_dating_mode: val });
  };

  const hasJoinedCommunities = joinedIds.size > 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Connect</Text>
        <CommunityContextSwitcher communities={joinedCommunities} />
      </View>

      {/* Sub-tabs */}
      <View style={styles.subTabRow}>
        {(['feed', 'events', 'rooms'] as SubTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            testID={`connect-tab-${tab}`}
            style={[styles.subTab, subTab === tab && styles.subTabActive]}
            onPress={() => switchTab(tab)}
          >
            <Text style={[styles.subTabText, subTab === tab && styles.subTabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      {/* Feed */}
      {subTab === 'feed' && (
        !hasJoinedCommunities ? (
          <View style={styles.emptyCenter}>
            <Text style={styles.emptyIcon}>🌸</Text>
            <Text style={styles.emptyTitle}>Join communities to see their posts here</Text>
            <TouchableOpacity style={styles.emptyCTA} onPress={() => router.push('/(tabs)/discover' as any)}>
              <Text style={styles.emptyCTAText}>Discover Communities →</Text>
            </TouchableOpacity>
          </View>
        ) : loadingFeed ? (
          <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
        ) : (
          <FlashList
            ref={feedListRef}
            data={posts}
            keyExtractor={(item) => item.id}
            estimatedItemSize={360}
            onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={32}
            onRefresh={() => void loadFeed()}
            refreshing={loadingFeed}
            contentContainerStyle={{ paddingVertical: 8 }}
            renderItem={({ item }) => (
              <View>
                <View style={styles.postMetaRow}>
                  <TouchableOpacity
                    onPress={() => router.push(`/community/${item.community_id}` as any)}
                  >
                    <View style={styles.communityPill}>
                      <Text style={styles.communityPillText}>{item.communities?.name ?? '—'}</Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.postTime}>{format(new Date(item.created_at), 'dd MMM')}</Text>
                </View>
                <FeedCard
                  post={item}
                  linkEntityName={item.link_entity_id ? gameNames[item.link_entity_id] : undefined}
                  isLiked={likedPostIds.has(item.id)}
                  isSaved={savedPostIds.has(item.id)}
                  onLike={() => void toggleLike(item.id)}
                  onSave={() => void toggleSave(item.id)}
                  onComment={() => {
                    setConnectScrollOffset(scrollOffsetRef.current);
                    router.push(contentDetailPath(item.id, item.post_type) as any);
                  }}
                  onShare={() => void Share.share({ message: 'Check this out on Roxy!' })}
                  onPress={() => {
                    setConnectScrollOffset(scrollOffsetRef.current);
                    router.push(contentDetailPath(item.id, item.post_type) as any);
                  }}
                />
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyCenter}>
                <Text style={styles.emptyIcon}>📝</Text>
                <Text style={styles.emptyTitle}>
                  {feedError ? 'Could not load feed' : 'No posts yet'}
                </Text>
                <Text style={styles.emptySub}>
                  {feedError
                    ? 'Pull to refresh or try again.'
                    : 'Be the first to post in your communities!'}
                </Text>
              </View>
            }
          />
        )
      )}

      {/* Events */}
      {subTab === 'events' && (
        !hasJoinedCommunities ? (
          <View style={styles.emptyCenter}>
            <Text style={styles.emptyIcon}>🗓️</Text>
            <Text style={styles.emptyTitle}>Join communities to see events</Text>
            <TouchableOpacity style={styles.emptyCTA} onPress={() => router.push('/(tabs)/discover' as any)}>
              <Text style={styles.emptyCTAText}>Discover Communities →</Text>
            </TouchableOpacity>
          </View>
        ) : loadingEvents ? (
          <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
        ) : (
          <FlashList
            data={events}
            keyExtractor={(item) => item.id}
            estimatedItemSize={100}
            extraData={rsvpIds}
            onRefresh={() => { loadEvents(); loadRsvps(); }}
            refreshing={loadingEvents}
            contentContainerStyle={{ paddingVertical: 8 }}
            renderItem={({ item }) => {
              const going = rsvpIds.has(item.id);
              return (
                <View style={styles.eventCard}>
                  {/* Tappable body → event detail */}
                  <TouchableOpacity
                    style={styles.eventCardBody}
                    onPress={() => router.push(`/event/${item.id}` as any)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.dateChip}>
                      <Text style={styles.dateDay}>{format(new Date(item.starts_at), 'dd')}</Text>
                      <Text style={styles.dateMonth}>{format(new Date(item.starts_at), 'MMM')}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.eventCommunity}>{item.communities?.name ?? '—'}</Text>
                      {item.location_text
                        ? <Text style={styles.eventLocation} numberOfLines={1}>📍 {item.location_text}</Text>
                        : null
                      }
                    </View>
                  </TouchableOpacity>
                  {/* RSVP button stays separate — does not trigger card tap */}
                  <TouchableOpacity
                    style={[styles.rsvpBtn, going && styles.rsvpBtnGoing]}
                    onPress={() => toggleRsvp(item.id)}
                  >
                    <Text style={[styles.rsvpBtnText, going && styles.rsvpBtnTextGoing]}>
                      {going ? 'Going ✓' : 'RSVP'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyCenter}>
                <Text style={styles.emptyIcon}>🗓️</Text>
                <Text style={styles.emptyTitle}>No upcoming events</Text>
                <Text style={styles.emptySub}>Check back soon for events in your communities!</Text>
              </View>
            }
          />
        )
      )}

      {/* Rooms */}
      {subTab === 'rooms' && (
        <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
          {/* Dating mode + Speed Dating banner */}
          <View style={styles.datingToggleRow}>
            <Text style={styles.datingLabel}>Dating Mode</Text>
            <Switch
              value={datingMode}
              onValueChange={toggleDatingMode}
              trackColor={{ false: colors.surface, true: colors.primary }}
              thumbColor={colors.textPrimary}
            />
          </View>
          {datingMode && (
            <TouchableOpacity
              style={styles.speedDateBanner}
              onPress={() => router.push('/speed-dating' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.speedDateIcon}>⚡</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.speedDateTitle}>Speed Dating</Text>
                <Text style={styles.speedDateSub}>Find your next match in 5 minutes</Text>
              </View>
              <Text style={styles.speedDateArrow}>›</Text>
            </TouchableOpacity>
          )}

          {/* Games */}
          <View style={styles.roomSection}>
            <Text style={styles.roomSectionTitle}>🎮 Games</Text>
            {loadingRooms ? (
              <ActivityIndicator color={colors.roxy} style={{ marginVertical: 16 }} />
            ) : games.length === 0 ? (
              <Text style={styles.roomEmpty}>No games available</Text>
            ) : (
              games.map((game) => (
                <TouchableOpacity
                  key={game.id}
                  style={styles.gameCard}
                  onPress={() => GAME_ROUTES[game.slug] && router.push(GAME_ROUTES[game.slug] as any)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.gameEmoji}>{game.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gameName}>{game.name}</Text>
                    {game.description && <Text style={styles.gameDesc} numberOfLines={1}>{game.description}</Text>}
                  </View>
                  <Text style={styles.gameArrow}>›</Text>
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* Community Rooms */}
          <View style={styles.roomSection}>
            <Text style={styles.roomSectionTitle}>📹 Community Rooms</Text>
            {loadingRooms ? (
              <ActivityIndicator color={colors.roxy} style={{ marginVertical: 16 }} />
            ) : rooms.length === 0 ? (
              <Text style={styles.roomEmpty}>No rooms active right now</Text>
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
                  community_name={room.communities?.name ?? null}
                  creator_display_name={room.creator_display_name}
                  onPress={() => router.push(`/(tabs)/connect/community-room-session?room_id=${room.id}` as any)}
                />
              ))
            )}
          </View>
        </ScrollView>
      )}
      </Animated.View>

    </SafeAreaView>
  );
}
