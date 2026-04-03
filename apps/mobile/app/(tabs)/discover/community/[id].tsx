import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useCommunityStore, Community } from '../../../../store/communityStore';
import { COLORS } from '../../../../lib/constants';

type SubTab = 'posts' | 'events' | 'games';

type PostRow = {
  id: string; content: string; created_at: string; author_id: string;
  comment_count: number;
  profiles: { display_name: string; avatar_url: string | null } | null;
};

type EventRow = {
  id: string; title: string; starts_at: string; location: string | null;
  description: string | null;
};

type MemberRow = {
  profiles: { id: string; display_name: string; avatar_url: string | null; username: string } | null;
};

function getCommunityLevel(n: number): { label: string; emoji: string } {
  if (n >= 100) return { label: 'Radiant', emoji: '✨' };
  if (n >= 20) return { label: 'Thriving', emoji: '🌸' };
  if (n >= 5) return { label: 'Growing', emoji: '🌿' };
  return { label: 'Seedling', emoji: '🌱' };
}

export default function CommunityDetailScreen() {
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
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersModalVisible, setMembersModalVisible] = useState(false);
  const [friendships, setFriendships] = useState<Set<string>>(new Set());

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
      .select('id, content, created_at, author_id, comment_count, profiles(display_name, avatar_url)')
      .eq('community_id', id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setPosts(data as PostRow[]);
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

  const loadRsvps = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('event_attendees')
      .select('event_id')
      .eq('user_id', user.id);
    if (data) setRsvpIds(new Set(data.map((r: any) => r.event_id)));
  }, [user]);

  const loadMembers = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('community_members')
      .select('profiles(id, display_name, avatar_url, username)')
      .eq('community_id', id)
      .limit(50);
    if (data) setMembers(data as unknown as MemberRow[]);

    // Also load existing friendships
    if (user) {
      const { data: friendData } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
      if (friendData) {
        const friendSet = new Set<string>();
        friendData.forEach((f: any) => {
          if (f.requester_id !== user.id) friendSet.add(f.requester_id);
          if (f.addressee_id !== user.id) friendSet.add(f.addressee_id);
        });
        setFriendships(friendSet);
      }
    }
  }, [id, user]);

  useEffect(() => {
    if (subTab === 'posts') loadPosts();
    if (subTab === 'events') { loadEvents(); loadRsvps(); }
  }, [subTab, loadPosts, loadEvents, loadRsvps]);

  const isJoined = id ? joinedIds.has(id) : false;

  const handleJoinLeave = async () => {
    if (!user || !id) return;
    if (isJoined) {
      await leaveCommunity(id, user.id);
    } else {
      await joinCommunity(id, user.id);
    }
    // Refresh store
    await fetchJoined(user.id);
    await fetchAll();
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

  const sendFriendRequest = async (targetId: string) => {
    if (!user) return;
    try {
      await supabase.from('friendships').insert({ requester_id: user.id, addressee_id: targetId, status: 'pending' });
      setFriendships((prev) => new Set([...prev, targetId]));
      Alert.alert('Friend request sent! 💜');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not send friend request');
    }
  };

  const openMembersModal = () => {
    loadMembers();
    setMembersModalVisible(true);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
      </SafeAreaView>
    );
  }

  if (!community) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.errorText}>Community not found</Text>
      </SafeAreaView>
    );
  }

  const level = getCommunityLevel(community.member_count);

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* Cover */}
      <View style={styles.cover}>
        <View style={styles.coverGradient}>
          <Text style={styles.coverEmoji}>{level.emoji}</Text>
        </View>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} stickyHeaderIndices={[1]}>
        {/* Info card */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.communityName}>{community.name}</Text>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeText}>{level.emoji} {level.label}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={openMembersModal} style={styles.membersRow}>
            <Text style={styles.membersText}>{community.member_count} members</Text>
            <View style={[styles.privacyPill, community.is_private && styles.privacyPillPrivate]}>
              <Text style={styles.privacyPillText}>{community.is_private ? '🔒 Private' : '🌐 Public'}</Text>
            </View>
          </TouchableOpacity>
          {community.description ? (
            <Text style={styles.communityDesc}>{community.description}</Text>
          ) : null}
          <TouchableOpacity
            style={[styles.joinBtn, isJoined && styles.joinBtnJoined]}
            onPress={handleJoinLeave}
          >
            <Text style={[styles.joinBtnText, isJoined && styles.joinBtnTextJoined]}>
              {isJoined ? 'Leave Community' : 'Join Community'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Sub-tabs (sticky) */}
        <View style={styles.subTabRow}>
          {(['posts', 'events', 'games'] as SubTab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.subTab, subTab === tab && styles.subTabActive]}
              onPress={() => setSubTab(tab)}
            >
              <Text style={[styles.subTabText, subTab === tab && styles.subTabTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Posts tab */}
        {subTab === 'posts' && (
          <View style={{ paddingTop: 8 }}>
            {posts.length === 0 ? (
              <View style={styles.emptyCenter}>
                <Text style={styles.emptyIcon}>📝</Text>
                <Text style={styles.emptyTitle}>No posts yet</Text>
                <Text style={styles.emptySub}>Be the first to post!</Text>
              </View>
            ) : (
              posts.map((post) => (
                <TouchableOpacity
                  key={post.id}
                  style={styles.postCard}
                  activeOpacity={0.85}
                  onPress={() => router.push({
                    pathname: '/(tabs)/discover/community/post/[postId]',
                    params: { postId: post.id },
                  } as any)}
                >
                  <View style={styles.postAuthorRow}>
                    <View style={styles.postAvatar}>
                      <Text style={{ fontSize: 14 }}>👤</Text>
                    </View>
                    <View>
                      <Text style={styles.postAuthorName}>{post.profiles?.display_name ?? 'Anonymous'}</Text>
                      <Text style={styles.postTime}>{format(new Date(post.created_at), 'dd MMM · HH:mm')}</Text>
                    </View>
                  </View>
                  <Text style={styles.postContent}>{post.content}</Text>
                  <View style={styles.postFooter}>
                    <Ionicons name="chatbubble-outline" size={13} color={COLORS.textMuted} />
                    <Text style={styles.commentCount}>{post.comment_count ?? 0}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
            {/* Spacer for FAB */}
            <View style={{ height: 80 }} />
          </View>
        )}

        {/* Events tab */}
        {subTab === 'events' && (
          <View style={{ paddingTop: 8 }}>
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
          </View>
        )}

        {/* Games tab */}
        {subTab === 'games' && (
          <View style={styles.gamesContainer}>
            <TouchableOpacity
              style={styles.gameCard}
              onPress={() => router.push('/(tabs)/connect/speed-dating' as any)}
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
          </View>
        )}
      </ScrollView>

      {/* FAB — create post (posts tab only) */}
      {subTab === 'posts' && isJoined && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push({ pathname: '/(tabs)/discover/community/create-post', params: { communityId: id } } as any)}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Members Modal */}
      <Modal
        visible={membersModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setMembersModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Members</Text>
              <TouchableOpacity onPress={() => setMembersModalVisible(false)}>
                <Ionicons name="close" size={22} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {members.map((m, i) => {
                const p = m.profiles;
                if (!p) return null;
                const isSelf = p.id === user?.id;
                const alreadyFriend = friendships.has(p.id);
                return (
                  <View key={p.id ?? i} style={styles.memberRow}>
                    <View style={styles.memberAvatar}>
                      <Text style={{ fontSize: 16 }}>👤</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{p.display_name}</Text>
                      <Text style={styles.memberUsername}>@{p.username}</Text>
                    </View>
                    {!isSelf && !alreadyFriend && (
                      <TouchableOpacity
                        style={styles.addFriendBtn}
                        onPress={() => sendFriendRequest(p.id)}
                      >
                        <Text style={styles.addFriendBtnText}>Add Friend</Text>
                      </TouchableOpacity>
                    )}
                    {alreadyFriend && (
                      <Text style={styles.friendLabel}>Friends 💜</Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },

  // Cover
  cover: { height: 200, position: 'relative' },
  coverGradient: {
    height: 200, backgroundColor: COLORS.secondary + '60',
    alignItems: 'center', justifyContent: 'center',
  },
  coverEmoji: { fontSize: 64 },
  backBtn: {
    position: 'absolute', top: 50, left: 16,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Info card
  infoCard: { backgroundColor: COLORS.surface, padding: 20, gap: 10 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  communityName: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800', flex: 1 },
  levelBadge: {
    backgroundColor: COLORS.secondary + '20', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  levelBadgeText: { color: COLORS.secondary, fontWeight: '700', fontSize: 12 },
  membersRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  membersText: { color: COLORS.roxy, fontWeight: '600', fontSize: 14, textDecorationLine: 'underline' },
  privacyPill: {
    backgroundColor: COLORS.primary + '20', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  privacyPillPrivate: { backgroundColor: COLORS.textMuted + '20' },
  privacyPillText: { color: COLORS.textMuted, fontSize: 11 },
  communityDesc: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20 },
  joinBtn: {
    backgroundColor: COLORS.roxy, borderRadius: 16,
    paddingVertical: 12, alignItems: 'center',
  },
  joinBtnJoined: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.textMuted + '60' },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  joinBtnTextJoined: { color: COLORS.textMuted },

  // Sub-tabs
  subTabRow: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  subTab: {
    flex: 1, paddingVertical: 8, borderRadius: 20,
    alignItems: 'center', backgroundColor: COLORS.surface,
  },
  subTabActive: { backgroundColor: COLORS.roxy },
  subTabText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  subTabTextActive: { color: '#fff' },

  // Posts
  postCard: { backgroundColor: COLORS.surface, marginHorizontal: 16, marginBottom: 10, borderRadius: 16, padding: 16 },
  postAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  postAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center',
  },
  postAuthorName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  postTime: { color: COLORS.textMuted, fontSize: 12 },
  postContent: { color: COLORS.textPrimary, fontSize: 15, lineHeight: 22 },
  postFooter: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  commentCount: { color: COLORS.textMuted, fontSize: 12 },

  // Events
  eventCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, marginHorizontal: 16, marginBottom: 10,
    borderRadius: 16, padding: 14,
  },
  dateChip: {
    width: 44, alignItems: 'center', backgroundColor: COLORS.primary + '20',
    borderRadius: 10, paddingVertical: 6,
  },
  dateDay: { color: COLORS.textPrimary, fontWeight: '800', fontSize: 16 },
  dateMonth: { color: COLORS.textMuted, fontSize: 11 },
  eventTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14, marginBottom: 2 },
  eventLocation: { color: COLORS.textSecondary, fontSize: 12 },
  rsvpBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.primary,
  },
  rsvpBtnGoing: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  rsvpBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  rsvpBtnTextGoing: { color: '#fff' },

  // Games
  gamesContainer: { padding: 16, gap: 16 },
  gameCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 16,
  },
  gameEmoji: { fontSize: 32 },
  gameTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  gameDesc: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18 },
  playBtn: {
    backgroundColor: COLORS.roxy, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  playBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // FAB
  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 8,
  },

  // Members modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '70%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceLight,
  },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center',
  },
  memberName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  memberUsername: { color: COLORS.textMuted, fontSize: 12 },
  addFriendBtn: {
    backgroundColor: COLORS.roxy, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  addFriendBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  friendLabel: { color: COLORS.roxy, fontSize: 12, fontWeight: '600' },

  // Error / empty
  errorText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 48, fontSize: 16 },
  emptyCenter: { alignItems: 'center', padding: 40, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptySub: { color: COLORS.textSecondary, textAlign: 'center' },
});
