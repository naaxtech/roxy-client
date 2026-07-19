import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator, Animated, ScrollView, Share, Platform, TextInput,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, usePathname, useLocalSearchParams } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useCommunityStore } from '../../../store/communityStore';
import { useFeedStore } from '../../../store/feedStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { logError } from '../../../lib/errorLogger';
import { normalizePost } from '../../../lib/posts';
import { contentDetailPath, linkedEntityPath } from '../../../lib/contentNavigation';
import { POST_WITH_AUTHOR_AND_COMMUNITY } from '../../../lib/supabaseQueries';
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { EmptyState } from '../../../components/ui/EmptyState';
import { CommunitiesBrowser } from '../../../components/community/CommunitiesBrowser';
import { EventsCalendar } from '../../../components/events/EventsCalendar';
import { CommunityRoomCard } from '../../../components/community/CommunityRoomCard';
import { FeedCard } from '../../../components/feed/FeedCard';
import type { Post } from '../../../types';


type SubTab = 'feed' | 'events' | 'rooms' | 'communities';

type PostRow = Post & {
  communities: { name: string } | null;
};

type EventRow = {
  id: string; title: string; starts_at: string; ends_at: string | null;
  location_text: string | null; community_id: string;
  is_paid: boolean; communities: { name: string } | null;
};

type CommunityRoomRow = {
  id: string; name: string; description: string | null;
  room_type: 'video' | 'audio'; status: 'live' | 'scheduled' | 'closed';
  scheduled_at: string | null; community_id: string;
  banner_url: string | null;
  communities: { name: string } | null;
  creator_display_name: string | null; is_active: boolean;
};


export default function ConnectScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile, setProfile } = useProfileStore();
  const { joinedIds, joinedCommunities, allCommunities, hydrated, hydrate, joinCommunity } = useCommunityStore();
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

  // Deep links (/communities shim, cross-tab CTAs) land on a specific subtab.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  useEffect(() => {
    if (tabParam && ['feed', 'events', 'rooms', 'communities'].includes(tabParam)) {
      setSubTab(tabParam as SubTab);
    }
  }, [tabParam]);

  const [posts, setPosts] = useState<PostRow[]>([]);
  // "communityId:userId" pairs for admins/moderators of joined communities —
  // the Connect feed is the admins' promotion surface; member posts live
  // inside each community.
  const [adminPairs, setAdminPairs] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [eventsView, setEventsView] = useState<'list' | 'calendar'>('list');
  const [feedError, setFeedError] = useState<string | null>(null);
  const [gameNames, setGameNames] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<EventRow[]>([]);
  const [rsvpIds, setRsvpIds] = useState<Set<string>>(new Set());
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [datingMode, setDatingMode] = useState(profile?.is_dating_mode ?? false);

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
    browseBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      minHeight: 34, borderRadius: 17, paddingHorizontal: 12,
      backgroundColor: colors.roxy,
    },
    browseBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surface, borderRadius: 14,
      marginHorizontal: 16, marginTop: 8, marginBottom: 2,
      paddingHorizontal: 12, paddingVertical: 8,
    },
    searchInput: { color: colors.textPrimary, fontSize: 14, flex: 1, paddingVertical: 0 },
    viewToggleRow: {
      flexDirection: 'row', gap: 6, justifyContent: 'flex-end',
      paddingHorizontal: 16, paddingTop: 8,
    },
    viewToggleBtn: {
      width: 34, height: 30, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    viewToggleBtnActive: { backgroundColor: colors.roxy },

    // Suggested communities rail (feed header)
    railWrap: { marginBottom: 6 },
    railBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, marginBottom: 8, marginTop: 2,
    },
    railTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 15 },
    railLink: { color: colors.roxy, fontSize: 13, fontWeight: '700' },
    railRow: { paddingHorizontal: 12, gap: 8 },
    railCard: {
      width: 132, backgroundColor: colors.surface, borderRadius: 16,
      padding: 12, alignItems: 'center', gap: 4,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    },
    railInfo: { alignItems: 'center', gap: 4 },
    railAva: {
      width: 42, height: 42, borderRadius: 13,
      alignItems: 'center', justifyContent: 'center',
    },
    railAvaText: { color: '#fff', fontWeight: '800', fontSize: 18 },
    railName: { color: colors.textPrimary, fontWeight: '700', fontSize: 12.5, textAlign: 'center' },
    railMeta: { color: colors.textMuted, fontSize: 11 },
    railJoin: {
      marginTop: 4, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 5,
      backgroundColor: colors.roxy,
    },
    railJoinText: { color: '#fff', fontWeight: '800', fontSize: 12 },

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

    // Games + Community Rooms
    roomSection: { paddingHorizontal: 12, marginBottom: 8, marginTop: 8 },
    roomSectionBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    roomSectionTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 15 },
    roomEmpty: { color: colors.textMuted, fontSize: 13, paddingVertical: 8 },
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
    let postsQuery = supabase
      .from('posts')
      .select(POST_WITH_AUTHOR_AND_COMMUNITY)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50);
    if (selectedCommunityId) {
      postsQuery = postsQuery.eq('community_id', selectedCommunityId);
    } else {
      postsQuery = postsQuery.in('community_id', ids);
    }
    const [{ data, error }, { data: adminRows }] = await Promise.all([
      postsQuery,
      supabase
        .from('community_members')
        .select('community_id, user_id')
        .in('community_id', ids)
        .in('role', ['admin', 'moderator']),
    ]);
    setAdminPairs(new Set((adminRows ?? []).map((r: { community_id: string; user_id: string }) => `${r.community_id}:${r.user_id}`)));
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
      .select('id, name, description, room_type, status, scheduled_at, community_id, banner_url, communities(name), profiles!created_by(display_name), is_active')
      .neq('status', 'closed')
      .eq('is_active', true)
      .order('name');
    if (selectedCommunityId) {
      roomsQuery = roomsQuery.eq('community_id', selectedCommunityId);
    }
    const { data: roomsData } = await roomsQuery;
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

  // Feed shows admin/moderator posts only (community promotion surface);
  // the search box filters whichever subtab is active.
  const q = query.trim().toLowerCase();
  const displayedPosts = useMemo(
    () => posts
      .filter((p) => adminPairs.has(`${p.community_id}:${p.author_id}`))
      .filter((p) => !q
        || (p.content ?? '').toLowerCase().includes(q)
        || (p.profiles?.display_name ?? '').toLowerCase().includes(q)
        || (p.communities?.name ?? '').toLowerCase().includes(q)),
    [posts, adminPairs, q],
  );
  const displayedEvents = useMemo(
    () => events.filter((e) => !q
      || e.title.toLowerCase().includes(q)
      || (e.communities?.name ?? '').toLowerCase().includes(q)
      || (e.location_text ?? '').toLowerCase().includes(q)),
    [events, q],
  );
  const displayedRooms = useMemo(
    () => rooms.filter((r) => !q
      || r.name.toLowerCase().includes(q)
      || (r.communities?.name ?? '').toLowerCase().includes(q)),
    [rooms, q],
  );

  // Discovery comes to the feed: suggest unjoined communities while the
  // user's community list is still small.
  const suggestions = joinedIds.size < 5
    ? allCommunities.filter((c) => !joinedIds.has(c.id)).slice(0, 6)
    : [];

  const SuggestionRail = suggestions.length > 0 ? (
    <View style={styles.railWrap}>
      <View style={styles.railBar}>
        <Text style={styles.railTitle}>Find your communities</Text>
        <TouchableOpacity onPress={() => switchTab('communities')} accessibilityLabel="See all communities">
          <Text style={styles.railLink}>See all →</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
        {suggestions.map((c, i) => (
          <View key={c.id} style={styles.railCard}>
            <TouchableOpacity
              style={styles.railInfo}
              onPress={() => router.push(`/community/${c.id}` as any)}
              activeOpacity={0.8}
            >
              <View style={[styles.railAva, { backgroundColor: ['#FF6A2E', '#8B5CF6', '#FF2F71', '#F472B6', '#C4476A', '#FF8A3D'][i % 6] }]}>
                <Text style={styles.railAvaText}>{c.name[0]?.toUpperCase()}</Text>
              </View>
              <Text style={styles.railName} numberOfLines={1}>{c.name}</Text>
              <Text style={styles.railMeta}>{c.member_count} members</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.railJoin}
              onPress={() => user && void joinCommunity(c.id, user.id).catch(() => {})}
              accessibilityLabel={`Join ${c.name}`}
            >
              <Text style={styles.railJoinText}>Join</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <ScreenHeader
        title="Connect"
        eyebrow="Your communities"
        actions={
          <>
            <CommunityContextSwitcher communities={joinedCommunities} />
            <TouchableOpacity
              style={styles.browseBtn}
              onPress={() => switchTab('communities')}
              accessibilityLabel="Browse communities"
            >
              <Ionicons name="compass" size={16} color="#fff" />
              <Text style={styles.browseBtnText}>Browse</Text>
            </TouchableOpacity>
          </>
        }
      />

      {/* Sub-tabs */}
      <View style={styles.subTabRow}>
        {(['feed', 'events', 'rooms', 'communities'] as SubTab[]).map((tab) => (
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

      {/* Quick search — filters the active subtab (Communities has its own) */}
      {subTab !== 'communities' && (
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={
              subTab === 'feed' ? 'Search announcements…'
              : subTab === 'events' ? 'Search events…'
              : 'Search rooms…'
            }
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            accessibilityLabel="Search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      {/* Feed */}
      {subTab === 'feed' && (
        !hasJoinedCommunities ? (
          <EmptyState
            emoji="🌸"
            title="Join communities to see their posts here"
            ctaLabel="Find your communities →"
            onCtaPress={() => switchTab('communities')}
          />
        ) : loadingFeed ? (
          <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
        ) : (
          <FlashList
            ref={feedListRef}
            data={displayedPosts}
            keyExtractor={(item) => item.id}
            estimatedItemSize={360}
            onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={32}
            onRefresh={() => void loadFeed()}
            refreshing={loadingFeed}
            contentContainerStyle={{ paddingVertical: 8 }}
            ListHeaderComponent={SuggestionRail}
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
                  onLinkPress={() => {
                    void linkedEntityPath(item).then((path) => {
                      router.push((path ?? contentDetailPath(item.id, item.post_type)) as any);
                    });
                  }}
                  onAuthorPress={() => router.push(`/user/${item.author_id}` as any)}
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
              <EmptyState
                emoji="📣"
                title={feedError ? 'Could not load feed' : q ? 'No matches' : 'No announcements yet'}
                body={feedError
                  ? 'Pull to refresh or try again.'
                  : q
                    ? 'Try a different search.'
                    : 'Admins post community news here. Open a community to see all member posts.'}
              />
            }
          />
        )
      )}

      {/* Events */}
      {subTab === 'events' && (
        !hasJoinedCommunities ? (
          <EmptyState
            emoji="🗓️"
            title="Join communities to see events"
            ctaLabel="Find your communities →"
            onCtaPress={() => switchTab('communities')}
          />
        ) : loadingEvents ? (
          <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
        ) : (
          <>
          <View style={styles.viewToggleRow}>
            {(['list', 'calendar'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.viewToggleBtn, eventsView === v && styles.viewToggleBtnActive]}
                onPress={() => setEventsView(v)}
                accessibilityLabel={v === 'list' ? 'List view' : 'Calendar view'}
              >
                <Ionicons
                  name={v === 'list' ? 'list' : 'calendar'}
                  size={16}
                  color={eventsView === v ? '#fff' : colors.textMuted}
                />
              </TouchableOpacity>
            ))}
          </View>
          {eventsView === 'calendar' ? (
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <EventsCalendar
                events={displayedEvents.map((e) => ({
                  id: e.id,
                  title: e.title,
                  starts_at: e.starts_at,
                  subtitle: e.communities?.name ?? e.location_text,
                }))}
                onEventPress={(eventId) => router.push(`/event/${eventId}` as any)}
              />
            </ScrollView>
          ) : (
          <FlashList
            data={displayedEvents}
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
              <EmptyState
                emoji="🗓️"
                title={q ? 'No matching events' : 'No upcoming events'}
                body={q ? 'Try a different search.' : 'Check back soon for events in your communities!'}
              />
            }
          />
          )}
          </>
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
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}

          {/* Games live in the Play tab — this subtab is rooms only. */}

          {/* Community Rooms */}
          <View style={styles.roomSection}>
            <View style={styles.roomSectionBar}>
              <Ionicons name="videocam" size={15} color={colors.roxy} />
              <Text style={styles.roomSectionTitle}>Community Rooms</Text>
            </View>
            {loadingRooms ? (
              <ActivityIndicator color={colors.roxy} style={{ marginVertical: 16 }} />
            ) : displayedRooms.length === 0 ? (
              <Text style={styles.roomEmpty}>{q ? 'No rooms match your search' : 'No rooms active right now'}</Text>
            ) : (
              displayedRooms.map((room) => (
                <CommunityRoomCard
                  key={room.id}
                  id={room.id}
                  name={room.name}
                  description={room.description}
                  room_type={room.room_type}
                  status={room.status}
                  scheduled_at={room.scheduled_at}
                  banner_url={room.banner_url}
                  community_name={room.communities?.name ?? null}
                  creator_display_name={room.creator_display_name}
                  onPress={() => router.push(`/community-room-session?room_id=${room.id}` as any)}
                />
              ))
            )}
          </View>
        </ScrollView>
      )}

      {/* Communities — discovery lives inside the tab flow */}
      {subTab === 'communities' && <CommunitiesBrowser />}
      </Animated.View>

    </SafeAreaView>
  );
}
