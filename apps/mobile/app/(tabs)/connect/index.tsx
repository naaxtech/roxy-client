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
import { contentDetailPath, linkedEntityPath } from '../../../lib/contentNavigation';
import { displayedLikeCount } from '../../../lib/reels';
import { fetchAnnouncementPage } from '../../../lib/announcements';
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { EmptyState } from '../../../components/ui/EmptyState';
import { CommunitiesBrowser } from '../../../components/community/CommunitiesBrowser';
import { EventsCalendar } from '../../../components/events/EventsCalendar';
import { CommunityRoomCard } from '../../../components/community/CommunityRoomCard';
import { FeedCard } from '../../../components/feed/FeedCard';
import { ReelsFeed } from '../../../components/feed/ReelsFeed';
import type { Post } from '../../../types';


// Connect is the public square, and it holds exactly one kind of content:
// community ANNOUNCEMENTS — one per community per UTC day, published under the
// community's own name (migration 073). What members say to each other lives
// inside each community and requires joining to read.
//
// The two content tabs split that one source by format rather than by scope.
// Text and photo announcements read as a scannable list; video does not — a
// 30-second clip in a card is a thumbnail you have to decide to tap. They want
// different containers, so they get different tabs.
type SubTab = 'feed' | 'reels' | 'events' | 'rooms' | 'communities';

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
  participant_count: number; max_participants: number | null;
};

/**
 * A PostgREST embed is generated as an array but arrives as a single object
 * for a to-one foreign key, so both shapes have to be accepted and narrowed.
 * That mismatch is exactly what the `any` in the map callback used to paper
 * over -- and with it went any check that the select list matched the fields
 * the screen reads, which is how participant_count went missing unnoticed.
 */
type Embedded<T> = T | T[] | null;

const firstOf = <T,>(value: Embedded<T>): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

type CommunityRoomSelectRow = Omit<CommunityRoomRow, 'creator_display_name' | 'communities'> & {
  communities: Embedded<{ name: string }>;
  profiles: Embedded<{ display_name: string | null }>;
};


export default function ConnectScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile, setProfile } = useProfileStore();
  const { joinedIds, joinedCommunities, allCommunities, hydrate, joinCommunity } = useCommunityStore();
  const { selectedCommunityId } = useCommunityFilterStore();
  const {
    likedPostIds, savedPostIds, likeCountDeltas, connectScrollOffset,
    init: initFeed, toggleLike, toggleSave, setConnectScrollOffset,
  } = useFeedStore();
  const colors = useThemeColors();

  const feedListRef = useRef<FlashList<PostRow>>(null);
  // Tracks live scroll position without touching Zustand on every frame —
  // writing to the store on each onScroll re-renders this screen mid-gesture and causes stutter.
  const scrollOffsetRef = useRef(connectScrollOffset);

  const [subTab, setSubTab] = useState<SubTab>('feed');
  // Set when the viewer taps a video card in the announcements feed: Reels then
  // opens on that video instead of at the top. Cleared by any other tab switch.
  const [reelsInitialPostId, setReelsInitialPostId] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const switchTab = (tab: SubTab, reelPostId: string | null = null) => {
    fadeAnim.setValue(0);
    setSubTab(tab);
    setReelsInitialPostId(reelPostId);
    Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  };

  // Deep links (/communities shim, cross-tab CTAs) land on a specific subtab.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  useEffect(() => {
    if (tabParam && ['feed', 'reels', 'events', 'rooms', 'communities'].includes(tabParam)) {
      setSubTab(tabParam as SubTab);
    }
  }, [tabParam]);

  const [posts, setPosts] = useState<PostRow[]>([]);
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
  const [roomsError, setRoomsError] = useState(false);

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

  /**
   * Connect → Feed: announcements, and nothing else.
   *
   * `announcement_feed` (migration 073) reaches EVERY community, not just the
   * joined ones — membership is worth +2 on the rank, never a WHERE clause.
   * That is deliberate: this is the surface where she finds communities she has
   * not met, so scoping it to what she already joined would close the only door
   * a brand-new account has. Ranking is interest-overlap × 8 + feed_score +
   * recency decay, so a first screen is populated and relevant on day one.
   *
   * Membership scoping used to be the filter here, paired with an adminPairs
   * heuristic that guessed at "is this an announcement?" by looking up who was
   * an admin. Both are gone: `posted_as_community` is now explicit, and the RPC
   * applies it server-side.
   */
  const loadFeed = useCallback(async () => {
    setLoadingFeed(true);
    setFeedError(null);
    const { page, error } = await fetchAnnouncementPage();
    if (error || !page) {
      logError(error ?? new Error('announcement_feed returned no page'), 'connect.loadFeed');
      // The raw PostgREST message names tables and columns — log it, never
      // render it.
      setFeedError('Could not load announcements.');
      setPosts([]);
    } else {
      setPosts(page.rows);
    }
    setLoadingFeed(false);
  }, []);

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
    setRoomsError(false);
    // participant_count and max_participants were missing from this select,
    // so CommunityRoomCard fell back to its `participant_count = 0` default
    // and every live room advertised "0 in" no matter how busy it was.
    let roomsQuery = supabase
      .from('community_rooms')
      .select('id, name, description, room_type, status, scheduled_at, community_id, banner_url, communities(name), profiles!created_by(display_name), is_active, participant_count, max_participants')
      .neq('status', 'closed')
      .eq('is_active', true)
      .order('name');
    if (selectedCommunityId) {
      roomsQuery = roomsQuery.eq('community_id', selectedCommunityId);
    }
    const { data: roomsData, error } = await roomsQuery;
    if (error) {
      // Previously discarded, which rendered an outage as "No rooms active
      // right now" -- the one message guaranteed to stop her looking.
      logError(error, 'connect_loadRooms');
      setRoomsError(true);
      setLoadingRooms(false);
      return;
    }
    setRooms(
      ((roomsData ?? []) as CommunityRoomSelectRow[]).map(
        ({ profiles, communities, ...room }) => ({
          ...room,
          communities: firstOf(communities),
          creator_display_name: firstOf(profiles)?.display_name ?? null,
        }),
      ),
    );
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

  // No `hydrated` gate: the announcement feed does not read the joined-community
  // list, so waiting on it would only delay the one screen that must be
  // populated for an account that has joined nothing.
  useEffect(() => {
    if (subTab === 'feed') void loadFeed();
  }, [subTab, loadFeed]);
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

  // Every row here is already an announcement — the RPC filters
  // `posted_as_community` server-side — so what is left to apply is the
  // viewer's own narrowing: the community switcher and the search box.
  //
  // Video is NOT excluded. It used to be — "a post appears in exactly one of the
  // two tabs" — but that silently swallowed any community announcement posted as
  // video: it vanished from announcements and only ever reappeared mixed into
  // Reels. Instagram keeps video in the home feed AND in a Reels tab, and so do
  // we: the card is the announcement, tapping it opens the player.
  const q = query.trim().toLowerCase();
  // This list fetches and holds its own rows, so `feedStore.toggleLike` — which
  // adjusts the copies inside `feedStore.posts` — never reaches them and the
  // count stayed frozen at fetch time while the heart filled. The store
  // publishes the net per-post delta for exactly this case; applying it here is
  // the contract described in `lib/reels.displayedLikeCount`.
  const displayedPosts = useMemo(
    () => posts
      // The switcher narrows the square to one community. Filtering the ranked
      // page rather than re-querying keeps the RPC's ordering intact — and the
      // switcher only ever lists communities she has joined, so the rows it can
      // select are always present in the page it filters.
      .filter((p) => !selectedCommunityId || p.community_id === selectedCommunityId)
      .filter((p) => !q
        || (p.content ?? '').toLowerCase().includes(q)
        || (p.profiles?.display_name ?? '').toLowerCase().includes(q)
        || (p.communities?.name ?? '').toLowerCase().includes(q))
      .map((p) => ({ ...p, like_count: displayedLikeCount(p, likeCountDeltas) })),
    [posts, selectedCommunityId, q, likeCountDeltas],
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

  /**
   * Four distinct reasons the square can be empty, and each one gets its own
   * exit. The one that matters most is the last: a brand-new account with no
   * communities lands here, and "nothing to see" with no way forward is how she
   * decides Roxy is dead.
   */
  const selectedCommunityName = selectedCommunityId
    ? joinedCommunities.find((c) => c.id === selectedCommunityId)?.name ?? 'this community'
    : null;

  const FeedEmpty = feedError ? (
    <EmptyState
      emoji="📣"
      title="Could not load announcements"
      body="Pull down to refresh and try again."
    />
  ) : q ? (
    <EmptyState emoji="🔍" title="No matches" body="Try a different search." />
  ) : selectedCommunityId ? (
    <EmptyState
      emoji="📣"
      title={`Nothing from ${selectedCommunityName} yet`}
      body="Communities post their news here once a day. Open it to see what members are talking about inside."
      ctaLabel="Open community →"
      onCtaPress={() => router.push(`/community/${selectedCommunityId}` as any)}
    />
  ) : (
    <EmptyState
      emoji="📣"
      title="No announcements yet"
      body="This is where communities share their news — one post each, once a day. Browse communities to find your people."
      ctaLabel="Find your communities →"
      onCtaPress={() => switchTab('communities')}
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <ScreenHeader
        title="Connect"
        eyebrow="What communities are sharing"
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
        {(['feed', 'reels', 'events', 'rooms', 'communities'] as SubTab[]).map((tab) => (
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

      {/* Quick search — filters the active subtab (Communities has its own).
          Reels is a full-bleed vertical player: a search bar above it would eat
          the frame and there is nothing on screen to filter. */}
      {subTab !== 'communities' && subTab !== 'reels' && (
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
      {/* Reels must mount INSIDE this flex:1 box, not beside it. As a sibling of
          an empty flex:1 sibling it got no height of its own, so it sized its
          pages off the window — 150–200dp taller than the space below the header
          and above the tab bar — and on shorter devices no cell ever cleared the
          viewability threshold and no video played at all. */}
      {subTab === 'reels' && (
        <ReelsFeed scope="announcements" initialPostId={reelsInitialPostId} />
      )}

      {/* Feed — no membership gate. An account that has joined nothing is
          exactly who this ranking exists for. */}
      {subTab === 'feed' && (
        loadingFeed ? (
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
            renderItem={({ item }) => {
              const openDetail = () => {
                setConnectScrollOffset(scrollOffsetRef.current);
                router.push(contentDetailPath(item.id, item.post_type) as any);
              };
              // A video card opens the player it was shot for, positioned on
              // itself — not a detail screen with a thumbnail on it.
              const openPrimary = item.post_type === 'video'
                ? () => switchTab('reels', item.id)
                : openDetail;
              return (
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
                  // `item` already carries the like delta — displayedPosts
                  // applies it once in the memo above. Do not apply it here too.
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
                  onComment={openDetail}
                  onShare={() => void Share.share({ message: 'Check this out on Roxy!' })}
                  onPress={openPrimary}
                />
              </View>
              );
            }}
            ListEmptyComponent={FeedEmpty}
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
            ) : roomsError ? (
              <TouchableOpacity onPress={() => void loadRooms()} accessibilityRole="button">
                <Text style={styles.roomEmpty}>
                  Couldn&apos;t load rooms just now. Tap to try again.
                </Text>
              </TouchableOpacity>
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
                  participant_count={room.participant_count}
                  max_participants={room.max_participants}
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
