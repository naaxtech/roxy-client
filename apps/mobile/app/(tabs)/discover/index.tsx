import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Animated,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useCommunityStore, Community } from '../../../store/communityStore';
import { COLORS } from '../../../lib/constants';

type SubTab = 'communities' | 'events' | 'games';

type EventRow = {
  id: string; title: string; starts_at: string; location: string | null; community_id: string;
  communities: { name: string } | null;
};

function getCommunityLevel(n: number): { label: string; emoji: string } {
  if (n >= 100) return { label: 'Radiant', emoji: '✨' };
  if (n >= 20) return { label: 'Thriving', emoji: '🌸' };
  if (n >= 5) return { label: 'Growing', emoji: '🌿' };
  return { label: 'Seedling', emoji: '🌱' };
}

export default function DiscoverScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { allCommunities, joinedIds, fetchAll, fetchJoined, joinCommunity, leaveCommunity } = useCommunityStore();

  const [subTab, setSubTab] = useState<SubTab>('communities');
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const switchTab = (tab: SubTab) => {
    fadeAnim.setValue(0);
    setSubTab(tab);
    Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  };
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [interestedIds, setInterestedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAll();
    if (user?.id) fetchJoined(user.id);
  }, [user?.id]);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    const now = new Date().toISOString();
    const { data } = await supabase
      .from('events')
      .select('*, communities(name)')
      .gte('starts_at', now)
      .order('starts_at')
      .limit(50);
    if (data) setEvents(data as EventRow[]);
    setLoadingEvents(false);
  }, []);

  const loadInterested = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('event_attendees')
      .select('event_id')
      .eq('user_id', user.id)
      .eq('status', 'interested');
    if (data) setInterestedIds(new Set(data.map((r: any) => r.event_id)));
  }, [user]);

  useEffect(() => {
    if (subTab === 'events') { loadEvents(); loadInterested(); }
  }, [subTab, loadEvents, loadInterested]);

  const toggleInterested = async (eventId: string) => {
    if (!user) return;
    if (interestedIds.has(eventId)) {
      await supabase.from('event_attendees').delete().eq('event_id', eventId).eq('user_id', user.id).eq('status', 'interested');
      setInterestedIds((prev) => { const n = new Set(prev); n.delete(eventId); return n; });
    } else {
      await supabase.from('event_attendees').insert({ event_id: eventId, user_id: user.id, status: 'interested' });
      setInterestedIds((prev) => new Set([...prev, eventId]));
    }
  };

  const handleJoinLeave = async (community: Community) => {
    if (!user) return;
    if (joinedIds.has(community.id)) {
      await leaveCommunity(community.id, user.id);
    } else {
      await joinCommunity(community.id, user.id);
    }
  };

  const filteredCommunities = search
    ? allCommunities.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          (c.description ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : allCommunities;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search communities, events..."
          placeholderTextColor={COLORS.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
      </View>

      {/* Sub-tabs */}
      <View style={styles.subTabRow}>
        {(['communities', 'events', 'games'] as SubTab[]).map((tab) => (
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
      {/* Communities */}
      {subTab === 'communities' && (
        <FlashList
          data={filteredCommunities}
          keyExtractor={(item) => item.id}
          estimatedItemSize={90}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => {
            const lvl = getCommunityLevel(item.member_count);
            const isJoined = joinedIds.has(item.id);
            return (
              <TouchableOpacity
                style={styles.communityCard}
                onPress={() => router.push(`/(tabs)/discover/community/${item.id}` as any)}
                activeOpacity={0.8}
              >
                <View style={styles.communityAvatar}>
                  <Text style={{ fontSize: 24 }}>{lvl.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.communityNameRow}>
                    <Text style={styles.communityName} numberOfLines={1}>{item.name}</Text>
                    <View style={styles.levelBadge}>
                      <Text style={styles.levelBadgeText}>{lvl.emoji} {lvl.label}</Text>
                    </View>
                  </View>
                  {item.description ? (
                    <Text style={styles.communityDesc} numberOfLines={1}>{item.description}</Text>
                  ) : null}
                  <View style={styles.communityMeta}>
                    <Text style={styles.communityMetaText}>
                      {item.is_private ? '🔒 Private' : '🌐 Public'} · {item.member_count} members
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.joinBtn, isJoined && styles.joinBtnJoined]}
                  onPress={() => handleJoinLeave(item)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.joinBtnText, isJoined && styles.joinBtnTextJoined]}>
                    {isJoined ? 'Joined' : 'Join'}
                  </Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyCenter}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>No communities found</Text>
            </View>
          }
        />
      )}

      {/* Events */}
      {subTab === 'events' && (
        loadingEvents ? (
          <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
        ) : (
          <FlashList
            data={events}
            keyExtractor={(item) => item.id}
            estimatedItemSize={100}
            onRefresh={() => { loadEvents(); loadInterested(); }}
            refreshing={loadingEvents}
            contentContainerStyle={{ paddingVertical: 8 }}
            renderItem={({ item }) => {
              const interested = interestedIds.has(item.id);
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
                    style={[styles.interestedBtn, interested && styles.interestedBtnActive]}
                    onPress={() => toggleInterested(item.id)}
                  >
                    <Text style={[styles.interestedBtnText, interested && styles.interestedBtnTextActive]}>
                      {interested ? 'Interested ✓' : 'Interested'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyCenter}>
                <Text style={styles.emptyIcon}>🗓️</Text>
                <Text style={styles.emptyTitle}>No upcoming events</Text>
              </View>
            }
          />
        )
      )}

      {/* Games */}
      {subTab === 'games' && (
        <View style={styles.gamesContainer}>
          {/* Speed Dating card */}
          <View style={styles.gameCard}>
            <Text style={styles.gameEmoji}>⚡</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.gameTitle}>Speed Dating</Text>
              <Text style={styles.gameDesc}>5-minute video speed dates. Match with someone new.</Text>
            </View>
            <TouchableOpacity
              style={styles.playBtn}
              onPress={() => router.push('/(tabs)/connect/speed-dating' as any)}
            >
              <Text style={styles.playBtnText}>Play Now</Text>
            </TouchableOpacity>
          </View>

          {/* Community Icebreakers */}
          <View style={styles.gameCard}>
            <Text style={styles.gameEmoji}>🎯</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.gameTitle}>Community Icebreakers</Text>
              <Text style={styles.gameDesc}>Play get-to-know-you games inside your communities.</Text>
              <Text style={styles.gameAvailable}>Available in communities</Text>
            </View>
            <TouchableOpacity
              style={styles.browseBtn}
              onPress={() => switchTab('communities')}
            >
              <Text style={styles.browseBtnText}>Browse</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  searchInput: {
    backgroundColor: COLORS.surface, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 9,
    color: COLORS.textPrimary, fontSize: 14,
  },

  // Sub-tabs
  subTabRow: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  subTab: {
    flex: 1, paddingVertical: 8, borderRadius: 20,
    alignItems: 'center', backgroundColor: COLORS.surface,
  },
  subTabActive: { backgroundColor: COLORS.roxy },
  subTabText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  subTabTextActive: { color: '#fff' },

  // Community cards
  communityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, marginHorizontal: 16, marginBottom: 10,
    borderRadius: 16, padding: 14,
  },
  communityAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center',
  },
  communityNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' },
  communityName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  levelBadge: {
    backgroundColor: COLORS.secondary + '20', borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  levelBadgeText: { color: COLORS.secondary, fontSize: 10, fontWeight: '700' },
  communityDesc: { color: COLORS.textMuted, fontSize: 12, marginBottom: 4 },
  communityMeta: { flexDirection: 'row', gap: 8 },
  communityMetaText: { color: COLORS.textMuted, fontSize: 11 },
  joinBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.roxy,
  },
  joinBtnJoined: { backgroundColor: COLORS.roxy, borderColor: COLORS.roxy },
  joinBtnText: { color: COLORS.roxy, fontWeight: '700', fontSize: 12 },
  joinBtnTextJoined: { color: '#fff' },

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
  eventCommunity: { color: COLORS.textMuted, fontSize: 12, marginBottom: 2 },
  eventLocation: { color: COLORS.textSecondary, fontSize: 12 },
  interestedBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.secondary,
  },
  interestedBtnActive: { backgroundColor: COLORS.secondary, borderColor: COLORS.secondary },
  interestedBtnText: { color: COLORS.secondary, fontWeight: '700', fontSize: 11 },
  interestedBtnTextActive: { color: '#fff' },

  // Games
  gamesContainer: { padding: 16, gap: 16 },
  gameCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 16,
  },
  gameEmoji: { fontSize: 32 },
  gameTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  gameDesc: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18 },
  gameAvailable: { color: COLORS.secondary, fontSize: 11, fontWeight: '600', marginTop: 4 },
  playBtn: {
    backgroundColor: COLORS.roxy, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  playBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  browseBtn: {
    backgroundColor: COLORS.surface, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: COLORS.secondary,
  },
  browseBtnText: { color: COLORS.secondary, fontWeight: '700', fontSize: 13 },

  // Empty
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12, marginTop: 40 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
});
