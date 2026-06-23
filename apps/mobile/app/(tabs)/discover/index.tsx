import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { usePathname } from 'expo-router';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Animated, Alert, Share, Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useCommunityStore, Community } from '../../../store/communityStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { logError } from '../../../lib/errorLogger';
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';
import { Image } from 'expo-image';
import { contentDetailPath } from '../../../lib/contentNavigation';
import { useFeedStore } from '../../../store/feedStore';
import { FeedCard } from '../../../components/feed/FeedCard';
import { FeedSkeleton } from '../../../components/feed/FeedSkeleton';
import { NewPostsBanner } from '../../../components/feed/NewPostsBanner';
import { useGamesStore } from '../../../store/gamesStore';
import type { Post } from '../../../types';

type SubTab = 'feed' | 'communities' | 'events' | 'games';

// ── Feed section ──────────────────────────────────────────────────────────────
function FeedSection({
  userId,
  feedCommunityIds,
  communitiesReady,
  onOpenContent,
}: {
  userId: string;
  feedCommunityIds: string[];
  communitiesReady: boolean;
  onOpenContent: (post: Post) => void;
}) {
  const colors = useThemeColors();
  const {
    posts, loading, loadingMore, hasMore, newPostCount, fetchError,
    likedPostIds, savedPostIds, discoverScrollOffset,
    init, fetchFeed, fetchMoreFeed,
    toggleLike, toggleSave, markSeen, acceptNewPosts, pushNewPost,
    setDiscoverScrollOffset,
  } = useFeedStore();

  const listRef = useRef<FlashList<Post>>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const communityKey = feedCommunityIds.join(',');
  const [gameNames, setGameNames] = useState<Record<string, string>>({});
  // Tracks live scroll position without touching Zustand on every frame —
  // writing to the store on each onScroll re-renders FeedSection mid-gesture and causes stutter.
  const scrollOffsetRef = useRef(discoverScrollOffset);

  const feedStyles = StyleSheet.create({
    empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
    emptyText: { color: colors.textMuted, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  });

  useEffect(() => {
    void supabase.from('games').select('id, name').then(({ data }) => {
      if (data) setGameNames(Object.fromEntries(data.map((g) => [g.id, g.name])));
    });
  }, []);

  useEffect(() => {
    if (!userId || !communitiesReady) return;
    void init(userId);
    void fetchFeed(feedCommunityIds);

    if (feedCommunityIds.length) {
      const ch = supabase
        .channel('feed-new-posts')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'posts',
          },
          (payload) => { pushNewPost(payload.new as Post); }
        )
        .subscribe();
      channelRef.current = ch;
    }
    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, communityKey, communitiesReady]);

  // Captured in onPress before navigation — immune to Zustand re-renders.
  // Module-level so it survives component unmount/remount on web.
  const pathname = usePathname();
  const prevPathnameRef = useRef('');

  // Web: pathname changes are reliable (URL-based). Detect return from content.
  // useFocusEffect does NOT fire on web when navigating via the root Stack.
  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;
    // Only restore when returning FROM a community content route
    if (!prev.startsWith('/community/') || discoverScrollOffset <= 0) return;
    let attempts = 0;
    const tryRestore = () => {
      if (listRef.current) {
        listRef.current.scrollToOffset({ offset: discoverScrollOffset, animated: false });
      } else if (++attempts < 8) {
        setTimeout(tryRestore, 100); // retry until FlashList mounts
      }
    };
    setTimeout(tryRestore, 80);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Native: useFocusEffect IS reliable — screen stays mounted in the stack.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web' || discoverScrollOffset <= 0) return;
      const t = setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: discoverScrollOffset, animated: false });
      }, 80);
      return () => clearTimeout(t);
    }, [discoverScrollOffset])
  );

  // Only skeleton on first load — background refetches must not blank the feed
  // (e.g. while opening a post from Connect, Discover tab stays mounted).
  if (!communitiesReady || (loading && posts.length === 0)) return <FeedSkeleton />;

  return (
    <View style={{ flex: 1 }}>
      {newPostCount > 0 && (
        <NewPostsBanner count={newPostCount} onPress={acceptNewPosts} />
      )}
      <FlashList
        ref={listRef}
        data={posts}
        keyExtractor={(item) => item.id}
        onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={32}
        renderItem={({ item }) => (
          <FeedCard
            post={item}
            linkEntityName={item.link_entity_id ? gameNames[item.link_entity_id] : undefined}
            isLiked={likedPostIds.has(item.id)}
            isSaved={savedPostIds.has(item.id)}
            onLike={() => void toggleLike(item.id)}
            onSave={() => void toggleSave(item.id)}
            onComment={() => onOpenContent(item)}
            onShare={() => void Share.share({ message: 'Check this out on Roxy!' })}
            onPress={() => {
              markSeen(item.id);
              // Commit the live offset to the store only at navigation time
              setDiscoverScrollOffset(scrollOffsetRef.current);
              onOpenContent(item);
            }}
          />
        )}
        estimatedItemSize={320}
        onEndReached={() => { if (hasMore && !loadingMore) void fetchMoreFeed(feedCommunityIds); }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore
            ? <ActivityIndicator color={colors.primary} style={{ padding: 20 }} />
            : null
        }
        ListEmptyComponent={
          <View style={feedStyles.empty}>
            <Text style={feedStyles.emptyText}>
              {fetchError
                ? `Could not load the feed. Pull to refresh or try again later.`
                : feedCommunityIds.length === 0
                  ? 'Join a community to see posts in your feed.'
                  : 'No posts yet. Join more communities to see content here.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

// ── Games section ─────────────────────────────────────────────────────────────
function GamesSection({
  communityId,
  onNavigateToGame,
  onNavigateToSpeedDating,
}: {
  communityId: string | null;
  onNavigateToGame: (gameId: string) => void;
  onNavigateToSpeedDating: () => void;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const { games, loading, fetchGames } = useGamesStore();

  const gamesStyles = StyleSheet.create({
    card: {
      flex: 1, margin: 4, backgroundColor: colors.surface,
      borderRadius: 12, padding: 10, gap: 6,
    },
    thumbnail: {
      width: '100%', aspectRatio: 16 / 9,
      backgroundColor: colors.surfaceLight, borderRadius: 8,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    thumbnailEmoji: { fontSize: 28 },
    gameName: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
    publisherBadge: { color: colors.textMuted, fontSize: 11 },
    roxyBadge: { color: colors.primary },
    playBtn: {
      backgroundColor: colors.primary, borderRadius: 10,
      paddingVertical: 6, alignItems: 'center',
    },
    playBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
    empty: { flex: 1, alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
    emptyText: { color: colors.textMuted, textAlign: 'center', fontSize: 14, lineHeight: 20 },
    suggestBtn: { alignItems: 'center', padding: 16 },
    suggestBtnText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  });

  useEffect(() => {
    if (communityId) void fetchGames(communityId);
  }, [communityId]);

  if (!communityId) {
    return (
      <View style={gamesStyles.empty}>
        <Text style={gamesStyles.emptyText}>Join a community to see games.</Text>
      </View>
    );
  }

  if (loading) return <ActivityIndicator color={colors.primary} style={{ marginTop: 48 }} />;

  return (
    <FlashList
      data={games}
      keyExtractor={(item) => item.id}
      estimatedItemSize={120}
      numColumns={2}
      contentContainerStyle={{ padding: 12 }}
      renderItem={({ item }) => {
        const isNative = item.url === null;
        return (
          <TouchableOpacity
            style={gamesStyles.card}
            onPress={() => isNative ? onNavigateToSpeedDating() : onNavigateToGame(item.id)}
            activeOpacity={0.8}
          >
            <View style={gamesStyles.thumbnail}>
              {item.thumbnail_url
                ? <Image source={{ uri: item.thumbnail_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                : <Text style={gamesStyles.thumbnailEmoji}>🎮</Text>
              }
            </View>
            <Text style={gamesStyles.gameName} numberOfLines={1}>{item.name}</Text>
            <Text style={[gamesStyles.publisherBadge, item.publisher_type === 'roxy' && gamesStyles.roxyBadge]}>
              {item.publisher_type === 'roxy' ? 'By Roxy' : 'Community'}
            </Text>
            <TouchableOpacity
              style={gamesStyles.playBtn}
              onPress={() => isNative ? onNavigateToSpeedDating() : onNavigateToGame(item.id)}
            >
              <Text style={gamesStyles.playBtnText}>Play</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        );
      }}
      ListEmptyComponent={
        <View style={gamesStyles.empty}>
          <Text style={gamesStyles.emptyText}>No games enabled yet. Ask your community admin to add some.</Text>
        </View>
      }
      ListFooterComponent={
        <TouchableOpacity
          style={gamesStyles.suggestBtn}
          onPress={() => router.push('/(tabs)/discover/games/submit' as any)}
        >
          <Text style={gamesStyles.suggestBtnText}>+ Suggest a game</Text>
        </TouchableOpacity>
      }
    />
  );
}

type EventRow = {
  id: string; title: string; starts_at: string; ends_at: string | null;
  location_text: string | null; community_id: string;
  is_paid: boolean; communities: { name: string } | null;
};

function getCommunityLevel(n: number): { label: string; emoji: string } {
  if (n >= 100) return { label: 'Radiant', emoji: '✨' };
  if (n >= 20) return { label: 'Thriving', emoji: '🌸' };
  if (n >= 5) return { label: 'Growing', emoji: '🌿' };
  return { label: 'Seedling', emoji: '🌱' };
}

export default function DiscoverScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const {
    allCommunities, joinedIds, joinedCommunities, hydrated,
    hydrate, joinCommunity, leaveCommunity,
  } = useCommunityStore();
  const { selectedCommunityId } = useCommunityFilterStore();

  const feedCommunityIds = useMemo(() => {
    let ids: string[];
    if (selectedCommunityId) ids = [selectedCommunityId];
    else if (joinedIds.size > 0) ids = Array.from(joinedIds);
    else ids = allCommunities.map((c) => c.id);
    return ids.slice().sort();
  }, [selectedCommunityId, joinedIds, allCommunities]);

  const [subTab, setSubTab] = useState<SubTab>('feed');
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
    void hydrate(user?.id);
  }, [user?.id, hydrate]);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    const now = new Date().toISOString();
    let query = supabase
      .from('events')
      .select('*, communities(name)')
      .eq('is_private', false)
      .gte('starts_at', now)
      .order('starts_at')
      .limit(50);
    if (selectedCommunityId) {
      query = query.eq('community_id', selectedCommunityId);
    }
    const { data } = await query;
    if (data) setEvents(data as EventRow[]);
    setLoadingEvents(false);
  }, [selectedCommunityId]);

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
    try {
      if (joinedIds.has(community.id)) {
        await leaveCommunity(community.id, user.id);
      } else {
        await joinCommunity(community.id, user.id);
      }
    } catch (e: any) {
      logError(e, 'handleJoinLeave');
      Alert.alert('Error', e?.message ?? 'Could not update membership');
    }
  };

  const filteredCommunities = search
    ? allCommunities.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          (c.description ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : allCommunities;

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6, gap: 8,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    headerTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    headerTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    searchInput: {
      backgroundColor: colors.surface, borderRadius: 16,
      paddingHorizontal: 14, paddingVertical: 7,
      color: colors.textPrimary, fontSize: 13,
    },

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

    // Community cards
    communityCard: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.surface, marginHorizontal: 12, marginBottom: 8,
      borderRadius: 12, padding: 10,
    },
    communityAvatar: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: colors.surfaceLight, alignItems: 'center', justifyContent: 'center',
    },
    communityNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' },
    communityName: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
    levelBadge: {
      backgroundColor: colors.secondary + '20', borderRadius: 8,
      paddingHorizontal: 6, paddingVertical: 2,
    },
    levelBadgeText: { color: colors.secondary, fontSize: 10, fontWeight: '700' },
    communityDesc: { color: colors.textMuted, fontSize: 11, marginBottom: 3 },
    communityMeta: { flexDirection: 'row', gap: 8 },
    communityMetaText: { color: colors.textMuted, fontSize: 11 },
    joinBtn: {
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
      borderWidth: 1, borderColor: colors.roxy,
    },
    joinBtnJoined: { backgroundColor: colors.roxy, borderColor: colors.roxy },
    joinBtnText: { color: colors.roxy, fontWeight: '700', fontSize: 11 },
    joinBtnTextJoined: { color: '#fff' },

    // Events
    eventCard: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.surface, marginHorizontal: 12, marginBottom: 8,
      borderRadius: 12, padding: 10,
    },
    eventCardBody: {
      flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1,
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
    interestedBtn: {
      paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
      borderWidth: 1, borderColor: colors.secondary,
    },
    interestedBtnActive: { backgroundColor: colors.secondary, borderColor: colors.secondary },
    interestedBtnText: { color: colors.secondary, fontWeight: '700', fontSize: 11 },
    interestedBtnTextActive: { color: '#fff' },

    // Empty
    emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12, marginTop: 40 },
    emptyIcon: { fontSize: 48 },
    emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>Discover</Text>
          <CommunityContextSwitcher communities={joinedCommunities} />
        </View>
        <TextInput
          style={styles.searchInput}
          placeholder="Search communities, events..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
      </View>

      {/* Sub-tabs */}
      <View style={styles.subTabRow}>
        {(['feed', 'communities', 'events', 'games'] as SubTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            testID={`discover-tab-${tab}`}
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
      {subTab === 'feed' && user && (
        <FeedSection
          userId={user.id}
          feedCommunityIds={feedCommunityIds}
          communitiesReady={hydrated}
          onOpenContent={(post) => {
            router.push(contentDetailPath(post.id, post.post_type) as any);
          }}
        />
      )}

      {/* Communities */}
      {subTab === 'communities' && (
        <FlashList
          data={filteredCommunities}
          keyExtractor={(item) => item.id}
          estimatedItemSize={90}
          extraData={joinedIds}
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
          <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
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
        <GamesSection
          communityId={joinedIds.size > 0 ? Array.from(joinedIds)[0] : null}
          onNavigateToGame={(id) => router.push(`/(tabs)/discover/games/${id}` as any)}
          onNavigateToSpeedDating={() => router.push('/speed-dating' as any)}
        />
      )}
      </Animated.View>
    </SafeAreaView>
  );
}
