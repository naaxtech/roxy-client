import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator, Animated, ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useCommunityStore } from '../../../store/communityStore';
import { COLORS } from '../../../lib/constants';
import { GAME_ROUTES } from '../../../lib/games';
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';


type SubTab = 'feed' | 'events' | 'rooms';

type PostRow = {
  id: string; content: string; created_at: string; community_id: string;
  author_id: string; comment_count: number;
  profiles: { display_name: string; avatar_url: string | null } | null;
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
  id: string; name: string; room_type: 'video' | 'audio';
  community_id: string;
  communities: { name: string } | null;
  is_active: boolean;
};

function formatEventDate(ts: string): string {
  const d = new Date(ts);
  return format(d, 'dd MMM · HH:mm');
}

export default function ConnectScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile, setProfile } = useProfileStore();
  const { joinedIds, joinedCommunities, fetchJoined } = useCommunityStore();
  const { selectedCommunityId } = useCommunityFilterStore();

  const [subTab, setSubTab] = useState<SubTab>('feed');
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const switchTab = (tab: SubTab) => {
    fadeAnim.setValue(0);
    setSubTab(tab);
    Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  };

  const [posts, setPosts] = useState<PostRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [rsvpIds, setRsvpIds] = useState<Set<string>>(new Set());
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [datingMode, setDatingMode] = useState(profile?.is_dating_mode ?? false);

  const [games, setGames] = useState<GameRow[]>([]);
  const [rooms, setRooms] = useState<CommunityRoomRow[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  // Ensure communities are loaded
  useEffect(() => {
    if (user?.id) fetchJoined(user.id);
  }, [user?.id]);

  // Load feed posts from joined communities
  const loadFeed = useCallback(async () => {
    const ids = Array.from(joinedIds);
    if (ids.length === 0) { setPosts([]); return; }
    setLoadingFeed(true);
    let query = supabase
      .from('posts')
      .select('*, comment_count, profiles(display_name, avatar_url), communities(name)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (selectedCommunityId) {
      query = query.eq('community_id', selectedCommunityId);
    } else {
      query = query.in('community_id', ids);
    }
    const { data } = await query;
    if (data) setPosts(data as PostRow[]);
    setLoadingFeed(false);
  }, [joinedIds, selectedCommunityId]);

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
      .select('id, name, room_type, community_id, communities(name), is_active')
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
    if (roomsData) setRooms(roomsData as unknown as CommunityRoomRow[]);
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

  useEffect(() => { if (subTab === 'feed') loadFeed(); }, [subTab, loadFeed]);
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
          <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
        ) : (
          <FlashList
            data={posts}
            keyExtractor={(item) => item.id}
            estimatedItemSize={120}
            onRefresh={loadFeed}
            refreshing={loadingFeed}
            contentContainerStyle={{ paddingVertical: 8 }}
            renderItem={({ item }) => (
              <View style={styles.postCard}>
                <View style={styles.postHeader}>
                  <TouchableOpacity
                    onPress={() => router.push(`/community/${item.community_id}` as any)}
                  >
                    <View style={styles.communityPill}>
                      <Text style={styles.communityPillText}>{item.communities?.name ?? '—'}</Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.postTime}>{format(new Date(item.created_at), 'dd MMM')}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => router.push(`/user/${item.author_id}` as any)}
                  hitSlop={{ top: 4, bottom: 4, left: 0, right: 40 }}
                >
                  <Text style={styles.postAuthor}>{item.profiles?.display_name ?? 'Anonymous'}</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.8} onPress={() => router.push(`/community/post/${item.id}` as any)}>
                  <Text style={styles.postContent} numberOfLines={4}>{item.content}</Text>
                </TouchableOpacity>
                <View style={styles.reactionRow}>
                  {['🌸', '💜', '🔥', '✊'].map((emoji) => (
                    <Text key={emoji} style={styles.reactionEmoji}>{emoji}</Text>
                  ))}
                  <TouchableOpacity
                    style={styles.commentBtn}
                    onPress={() => router.push(`/community/post/${item.id}` as any)}
                  >
                    <Text style={styles.commentBtnText}>💬 {item.comment_count ?? 0}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyCenter}>
                <Text style={styles.emptyIcon}>📝</Text>
                <Text style={styles.emptyTitle}>No posts yet</Text>
                <Text style={styles.emptySub}>Be the first to post in your communities!</Text>
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
          <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
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
              trackColor={{ false: COLORS.surface, true: COLORS.primary }}
              thumbColor={COLORS.textPrimary}
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
              <ActivityIndicator color={COLORS.roxy} style={{ marginVertical: 16 }} />
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
              <ActivityIndicator color={COLORS.roxy} style={{ marginVertical: 16 }} />
            ) : rooms.length === 0 ? (
              <Text style={styles.roomEmpty}>No rooms active right now</Text>
            ) : (
              rooms.map((room) => (
                <TouchableOpacity
                  key={room.id}
                  style={styles.roomCard}
                  onPress={() => router.push(`/(tabs)/connect/community-room-session?room_id=${room.id}` as any)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.roomTypeIcon}>{room.room_type === 'video' ? '🎥' : '🎙️'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roomName}>{room.name}</Text>
                    {room.communities?.name && (
                      <Text style={styles.roomCommunity}>{room.communities.name}</Text>
                    )}
                  </View>
                  <Text style={styles.roomArrow}>›</Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        </ScrollView>
      )}
      </Animated.View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },

  // Sub-tabs — underline style
  subTabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  subTab: {
    flex: 1, paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  subTabActive: { borderBottomColor: COLORS.roxy },
  subTabText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  subTabTextActive: { color: COLORS.roxy, fontWeight: '700' },

  // Feed posts
  postCard: {
    backgroundColor: COLORS.surface, marginHorizontal: 12, marginBottom: 8,
    borderRadius: 12, padding: 10,
  },
  postHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  communityPill: {
    backgroundColor: COLORS.primary + '30', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  communityPillText: { color: COLORS.primary, fontSize: 11, fontWeight: '700' },
  postTime: { color: COLORS.textMuted, fontSize: 11 },
  postAuthor: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 4 },
  postContent: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  reactionRow: { flexDirection: 'row', gap: 10, marginTop: 8, alignItems: 'center' },
  reactionEmoji: { fontSize: 16, color: COLORS.textMuted },
  commentBtn: { marginLeft: 'auto' as any },
  commentBtnText: { color: COLORS.textMuted, fontSize: 13 },

  // Events
  eventCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, marginHorizontal: 12, marginBottom: 8,
    borderRadius: 12, padding: 10,
  },
  dateChip: {
    width: 36, alignItems: 'center', backgroundColor: COLORS.primary + '20',
    borderRadius: 8, paddingVertical: 4,
  },
  dateDay: { color: COLORS.textPrimary, fontWeight: '800', fontSize: 14 },
  dateMonth: { color: COLORS.textMuted, fontSize: 10 },
  eventTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 13, marginBottom: 2 },
  eventCommunity: { color: COLORS.textMuted, fontSize: 11, marginBottom: 2 },
  eventLocation: { color: COLORS.textSecondary, fontSize: 11 },
  eventCardBody: {
    flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1,
  },
  rsvpBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.primary,
  },
  rsvpBtnGoing: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  rsvpBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 11 },
  rsvpBtnTextGoing: { color: '#fff' },

  // Rooms (dating toggle + speed date banner carried over)
  datingToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  datingLabel: { color: COLORS.textSecondary, fontSize: 13 },
  speedDateBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.primary + '20',
    borderBottomWidth: 1, borderBottomColor: COLORS.primary + '40',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  speedDateIcon: { fontSize: 22 },
  speedDateTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  speedDateSub: { color: COLORS.textSecondary, fontSize: 12 },
  speedDateArrow: { color: COLORS.textMuted, fontSize: 20 },

  // Games + Community Rooms
  roomSection: { paddingHorizontal: 12, marginBottom: 8, marginTop: 8 },
  roomSectionTitle: { color: COLORS.textPrimary, fontWeight: '800', fontSize: 15, marginBottom: 8 },
  roomEmpty: { color: COLORS.textMuted, fontSize: 13, paddingVertical: 8 },
  gameCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 6,
  },
  gameEmoji: { fontSize: 24 },
  gameName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  gameDesc: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  gameArrow: { color: COLORS.textMuted, fontSize: 20 },
  roomCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: COLORS.primary + '30',
  },
  roomTypeIcon: { fontSize: 20 },
  roomName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  roomCommunity: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  roomArrow: { color: COLORS.textMuted, fontSize: 20 },

  // Empty states
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptySub: { color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
  emptyCTA: { backgroundColor: COLORS.roxy, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10 },
  emptyCTAText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
