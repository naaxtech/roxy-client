import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert, Dimensions, Share,
} from 'react-native';
import { Image } from 'expo-image';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useCommunityStore, Community } from '../../../../store/communityStore';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { logError } from '../../../../lib/errorLogger';
import { Analytics } from '../../../../lib/analytics';
import { CommunityRoomCard } from '../../../../components/community/CommunityRoomCard';
import { CommunityRoom } from '../../../../types';

type SubTab = 'posts' | 'events' | 'games' | 'rooms';

const SCREEN_WIDTH = Dimensions.get('window').width;
const TABS: SubTab[] = ['posts', 'events', 'games', 'rooms'];

type PostRow = {
  id: string; content: string; created_at: string; author_id: string;
  comment_count: number;
  profiles: { display_name: string; avatar_url: string | null } | null;
};

type EventRow = {
  id: string; title: string; starts_at: string; location: string | null;
  description: string | null;
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
  const { user } = useAuthStore();
  const { joinedIds, allCommunities, joinCommunity, leaveCommunity, fetchAll, fetchJoined } = useCommunityStore();

  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<SubTab>('posts');
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [rsvpIds, setRsvpIds] = useState<Set<string>>(new Set());
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [rooms, setRooms] = useState<(CommunityRoom & { creator_display_name: string | null })[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

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

  const loadPosts = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('posts')
      .select('id, content, created_at, author_id, comment_count, profiles!posts_author_id_fkey(display_name, avatar_url)')
      .eq('community_id', id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setPosts(data as unknown as PostRow[]);
  }, [id]);

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

  // Load all tab content upfront so swiping is instant
  useEffect(() => {
    loadPosts();
    loadEvents();
    loadRsvps();
    loadRooms();

    if (!id) return;
    // Realtime: keep participant_count and status live while on this screen
    const channel = supabase
      .channel(`community-rooms-${id}`)
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
  }, [loadPosts, loadEvents, loadRsvps, loadRooms, id]);

  const pagerRef = useRef<ScrollView>(null);

  const handleTabPress = (tab: SubTab) => {
    const index = TABS.indexOf(tab);
    setSubTab(tab);
    pagerRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
  };

  const isJoined = id ? joinedIds.has(id) : false;

  const toggleLike = (postId: string) => {
    setLikedIds((prev) => {
      const n = new Set(prev);
      if (n.has(postId)) { n.delete(postId); } else { n.add(postId); }
      return n;
    });
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
      Alert.alert('Error', e?.message ?? 'Could not update membership');
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

    // Posts
    postCard: { backgroundColor: colors.surface, marginHorizontal: 12, marginBottom: 8, borderRadius: 12, padding: 10 },
    postAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    postAvatar: {
      width: 28, height: 28, borderRadius: 14,
      backgroundColor: colors.surfaceLight, alignItems: 'center', justifyContent: 'center',
    },
    postAvatarText: { color: colors.textSecondary, fontWeight: '700', fontSize: 11 },
    postAuthorName: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
    postTime: { color: colors.textMuted, fontSize: 11 },
    postContent: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
    postFooter: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
    footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    footerCount: { color: colors.textMuted, fontSize: 12 },

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

    // Error / empty
    errorText: { color: colors.textMuted, textAlign: 'center', marginTop: 48, fontSize: 16 },
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

  if (!community) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.errorText}>Community not found</Text>
      </SafeAreaView>
    );
  }

  const level = getCommunityLevel(community.member_count);

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* Compact header — content starts almost immediately, no decorative banner */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
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
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
          setSubTab(TABS[index]);
        }}
      >
        {/* Page 0 — Posts */}
        <ScrollView style={{ width: SCREEN_WIDTH }} contentContainerStyle={{ paddingTop: 8, paddingBottom: 80 }}>
          {posts.length === 0 ? (
            <View style={styles.emptyCenter}>
              <Text style={styles.emptyIcon}>📝</Text>
              <Text style={styles.emptyTitle}>No posts yet</Text>
              <Text style={styles.emptySub}>Be the first to post!</Text>
            </View>
          ) : (
            posts.map((post) => (
              <View key={post.id} style={styles.postCard}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.postAuthorRow}
                  onPress={() => router.push(`/user/${post.author_id}` as any)}
                >
                  <View style={styles.postAvatar}>
                    <Text style={styles.postAvatarText}>{post.profiles?.display_name?.[0]?.toUpperCase() ?? '?'}</Text>
                  </View>
                  <View>
                    <Text style={styles.postAuthorName}>{post.profiles?.display_name ?? 'Anonymous'}</Text>
                    <Text style={styles.postTime}>{format(new Date(post.created_at), 'dd MMM · HH:mm')}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.8} onPress={() => router.push(`/community/post/${post.id}` as any)}>
                  <Text style={styles.postContent}>{post.content}</Text>
                </TouchableOpacity>
                <View style={styles.postFooter}>
                  <TouchableOpacity
                    style={styles.footerBtn}
                    onPress={() => toggleLike(post.id)}
                    accessibilityRole="button"
                    accessibilityLabel={likedIds.has(post.id) ? 'Unlike post' : 'Like post'}
                  >
                    <Ionicons
                      name={likedIds.has(post.id) ? 'heart' : 'heart-outline'}
                      size={16}
                      color={likedIds.has(post.id) ? colors.roxy : colors.textMuted}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.footerBtn} onPress={() => router.push(`/community/post/${post.id}` as any)}>
                    <Ionicons name="chatbubble-outline" size={13} color={colors.textMuted} />
                    <Text style={styles.footerCount}>{post.comment_count ?? 0}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.footerBtn} onPress={() => Share.share({ message: post.content })}>
                    <Ionicons name="share-outline" size={13} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>

        {/* Page 1 — Events */}
        <ScrollView style={{ width: SCREEN_WIDTH }} contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}>
          {events.length === 0 ? (
            <View style={styles.emptyCenter}>
              <Text style={styles.emptyIcon}>🗓️</Text>
              <Text style={styles.emptyTitle}>No upcoming events</Text>
            </View>
          ) : (
            events.map((event) => {
              const going = rsvpIds.has(event.id);
              return (
                <View key={event.id} style={styles.eventCard}>
                  <View style={styles.dateChip}>
                    <Text style={styles.dateDay}>{format(new Date(event.starts_at), 'dd')}</Text>
                    <Text style={styles.dateMonth}>{format(new Date(event.starts_at), 'MMM')}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                    {event.location && <Text style={styles.eventLocation} numberOfLines={1}>📍 {event.location}</Text>}
                  </View>
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

        {/* Page 2 — Games */}
        <ScrollView style={{ width: SCREEN_WIDTH }} contentContainerStyle={styles.gamesContainer}>
          <TouchableOpacity
            style={styles.gameCard}
            onPress={() => router.push('/speed-dating' as any)}
            activeOpacity={0.8}
          >
            <Text style={styles.gameEmoji}>⚡</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.gameTitle}>Speed Dating</Text>
              <Text style={styles.gameDesc}>5-minute video speed dates. Match with someone new.</Text>
            </View>
            <View style={styles.playBtn}>
              <Text style={styles.playBtnText}>Play Now</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.gameCard}>
            <Text style={styles.gameEmoji}>🎯</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.gameTitle}>Icebreakers</Text>
              <Text style={styles.gameDesc}>More community games coming soon! 💜</Text>
            </View>
          </View>
        </ScrollView>

        {/* Page 3 — Rooms */}
        <ScrollView style={{ width: SCREEN_WIDTH }} contentContainerStyle={{ padding: 12, paddingBottom: 80 }}>
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
                community_name={null}
                creator_display_name={room.creator_display_name}
                participant_count={room.participant_count}
                max_participants={room.max_participants}
                hideCommunityTag={true}
                onPress={() => router.push(`/(tabs)/connect/community-room-session?room_id=${room.id}` as any)}
              />
            ))
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

