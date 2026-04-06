import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator, Animated,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format, isToday, isYesterday } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useConnectStore } from '../../../store/connectStore';
import { useCommunityStore } from '../../../store/communityStore';
import { COLORS } from '../../../lib/constants';
import { Conversation } from '../../../types';


type SubTab = 'feed' | 'events' | 'chats';

type PostRow = {
  id: string; content: string; created_at: string; community_id: string;
  author_id: string; comment_count: number;
  profiles: { display_name: string; avatar_url: string | null } | null;
  communities: { name: string } | null;
};

type EventRow = {
  id: string; title: string; starts_at: string; location: string | null; community_id: string;
  communities: { name: string } | null;
};

function formatLastMessage(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd MMM');
}

function formatEventDate(ts: string): string {
  const d = new Date(ts);
  return format(d, 'dd MMM · HH:mm');
}

function ConversationRow({
  item, currentUserId, unreadCount, onPress,
}: { item: Conversation; currentUserId: string; unreadCount: number; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {item.conversation_type === 'speed_date' ? '⚡' : item.conversation_type === 'sister' ? '💜' : '💬'}
        </Text>
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.conversation_type === 'speed_date' ? 'Speed Date Match' : item.conversation_type === 'sister' ? 'Sister Chat' : 'Direct Message'}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {formatLastMessage(item.last_message_at) || 'Tap to open'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowTime}>{formatLastMessage(item.last_message_at)}</Text>
        {unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function ConnectScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile, setProfile } = useProfileStore();
  const { conversations, setConversations, unreadCounts } = useConnectStore();
  const { joinedIds, fetchJoined } = useCommunityStore();

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
  const [loadingChats, setLoadingChats] = useState(true);
  const [datingMode, setDatingMode] = useState(profile?.is_dating_mode ?? false);

  // Ensure communities are loaded
  useEffect(() => {
    if (user?.id) fetchJoined(user.id);
  }, [user?.id]);

  // Load feed posts from joined communities
  const loadFeed = useCallback(async () => {
    const ids = Array.from(joinedIds);
    if (ids.length === 0) { setPosts([]); return; }
    setLoadingFeed(true);
    const { data } = await supabase
      .from('posts')
      .select('*, comment_count, profiles(display_name, avatar_url), communities(name)')
      .in('community_id', ids)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setPosts(data as PostRow[]);
    setLoadingFeed(false);
  }, [joinedIds]);

  // Load upcoming events from joined communities
  const loadEvents = useCallback(async () => {
    const ids = Array.from(joinedIds);
    if (ids.length === 0) { setEvents([]); return; }
    setLoadingEvents(true);
    const now = new Date().toISOString();
    const { data } = await supabase
      .from('events')
      .select('*, communities(name)')
      .in('community_id', ids)
      .gte('starts_at', now)
      .order('starts_at')
      .limit(20);
    if (data) setEvents(data as EventRow[]);
    setLoadingEvents(false);
  }, [joinedIds]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    if (!user) return;
    setLoadingChats(true);
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .contains('participant_ids', [user.id])
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (data) setConversations(data as Conversation[]);
    setLoadingChats(false);
  }, [user]);

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
  useEffect(() => { if (subTab === 'chats') loadConversations(); }, [subTab, loadConversations]);

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
      </View>

      {/* Sub-tabs */}
      <View style={styles.subTabRow}>
        {(['feed', 'events', 'chats'] as SubTab[]).map((tab) => (
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
            onRefresh={() => { loadEvents(); loadRsvps(); }}
            refreshing={loadingEvents}
            contentContainerStyle={{ paddingVertical: 8 }}
            renderItem={({ item }) => {
              const going = rsvpIds.has(item.id);
              return (
                <View style={styles.eventCard}>
                  <View style={styles.dateChip}>
                    <Text style={styles.dateDay}>{format(new Date(item.starts_at), 'dd')}</Text>
                    <Text style={styles.dateMonth}>{format(new Date(item.starts_at), 'MMM')}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.eventCommunity}>{item.communities?.name ?? '—'}</Text>
                    {item.location && <Text style={styles.eventLocation} numberOfLines={1}>📍 {item.location}</Text>}
                  </View>
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

      {/* Chats */}
      {subTab === 'chats' && (
        <View style={{ flex: 1 }}>
          {/* Dating toggle */}
          <View style={styles.datingToggleRow}>
            <Text style={styles.datingLabel}>Dating Mode</Text>
            <Switch
              value={datingMode}
              onValueChange={toggleDatingMode}
              trackColor={{ false: COLORS.surface, true: COLORS.primary }}
              thumbColor={COLORS.textPrimary}
            />
          </View>

          {/* Speed date banner */}
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

          {loadingChats ? (
            <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
          ) : conversations.length === 0 ? (
            <View style={styles.emptyCenter}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptySub}>Match with someone in Speed Dating or connect in your communities.</Text>
            </View>
          ) : (
            <FlashList
              data={conversations}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <ConversationRow
                  item={item}
                  currentUserId={user?.id ?? ''}
                  unreadCount={unreadCounts[item.id] ?? 0}
                  onPress={() => router.push(`/chat/${item.id}` as any)}
                />
              )}
              estimatedItemSize={72}
              onRefresh={loadConversations}
              refreshing={loadingChats}
            />
          )}
        </View>
      )}
      </Animated.View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
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
  rsvpBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.primary,
  },
  rsvpBtnGoing: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  rsvpBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 11 },
  rsvpBtnTextGoing: { color: '#fff' },

  // Chats
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
  row: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  avatarText: { fontSize: 16 },
  rowContent: { flex: 1, marginRight: 8 },
  rowName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  rowSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowTime: { color: COLORS.textMuted, fontSize: 12 },
  unreadBadge: {
    backgroundColor: COLORS.primary, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2, minWidth: 20, alignItems: 'center',
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Empty states
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptySub: { color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
  emptyCTA: { backgroundColor: COLORS.roxy, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10 },
  emptyCTAText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
