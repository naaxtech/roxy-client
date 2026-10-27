import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { TouchableOpacity } from '../../../components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useAppWidth } from '../../../hooks/useAppWidth';
import { useAuthStore } from '../../../store/authStore';
import { useCommunityStore } from '../../../store/communityStore';
import { useBuildStore } from '../../../store/buildStore';
import { TYPE } from '../../../lib/typography';
import { RADII, SPACE, MARGIN, type ThemeColors } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { onListScroll, onListContentSizeChange, LIST_SCROLL_THROTTLE } from '../../../lib/roxyFab';
import { FAB_LANE } from '../../../components/nav/navTokens';
import { formatMoney } from '../../../lib/currency';
import { isPlayableGameUrl } from '../../../lib/gameUrl';
import { fetchUnreadNotificationCount } from '../../../lib/notifications';
import { logError } from '../../../lib/errorLogger';
import { Rail } from '../../../components/discover/Rail';
import { ArchiveRail } from '../../../components/archive/ArchiveRail';
import { fetchArchiveTotal } from '../../../components/archive/archiveCount';
import { fetchArchiveEntries, type ArchiveEntry } from '../../../lib/archive';
import { archiveDetailPath } from '../../../lib/contentNavigation';
import { FilterChips } from '../../../components/discover/FilterChips';
import { byTheme } from '../../../components/discover/byTheme';
import {
  EventPoster, CommunityRow, LiveRow, ListRow, MemberCard, TileCard, type JoinState,
} from '../../../components/discover/DiscoverCards';
import { QuestionOfTheDayCard } from '../../../components/grow/QuestionOfTheDayCard';
import {
  DISCOVER_CHIPS, EVENT_FILTERS, ECONOMY_FILTERS,
  discoverLayout, railVisible, eventMatchesFilter, economyKind, economyWlwOnly, economySavedOnly,
  type DiscoverChip, type EventFilter, type EconomyFilter,
} from '../../../components/discover/discoverFilters';
import { fetchTopMembers, memberName, memberSubtitle, type TopMember } from '../../../lib/topMembers';
import {
  useLiveRooms, useEvents, useGames, useImpact, useSupport,
} from '../../../components/discover/useDiscoverData';
import { FeatureGate } from '../../../components/features/FeatureGate';
import { NearbyRail } from '../../../components/nearby/NearbyRail';
import { officialFirst } from '../../../lib/officialGrant';

/** Header icons: 24 dp outlines. */
const ICON = 24;
/** The search pill (direction › Discover: "a 52 dp pill search field on raised"). */
const SEARCH_HEIGHT = 52;
/** Rails show two full cards plus a peek (direction › FAB lane). */
const CARDS_PER_VIEW = 2.4;
/** Rows shown under For you before "See all". */
const COMMUNITY_ROWS = 3;

type EventMode = 'online' | 'in_person' | 'hybrid';

/** The event's mode in words — sentence case, and a hybrid event says both. */
function modeWords(mode: EventMode): string {
  if (mode === 'online') return 'Online';
  if (mode === 'hybrid') return 'In person and online';
  return 'In person';
}

/** "2,310 members" — tabular, grouped by the device locale. */
function membersLine(count: number): string {
  const n = Math.max(0, count ?? 0);
  return `${n.toLocaleString()} ${n === 1 ? 'member' : 'members'}`;
}

/**
 * Discover (design direction v2 › Discover, board v2-05).
 *
 * `headline` title and the bell; a 52 dp search pill on `raised`; the chip row
 * (For you · Events · Communities · Archive · Shops · Live · Games) with an end
 * fade. Then sections with a `title` heading and "See all" only when there is
 * more: events as posters in identity colours (two full plus a peek),
 * Communities for you as 72 dp rows with crest squircles and a tonal Join, the
 * Question of the Day, From the Archive, Live now (dot + word), Shops, Games
 * and Top 10 members (photo-first, rank as a plain number).
 *
 * v0's hero card is retired: the posters are the lead block. Every section
 * owns its loading, empty and error state through `Rail`, and every section
 * loads independently. `discoverFilters.ts` owns which sections are on screen.
 */
function DiscoverScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const appWidth = useAppWidth();
  const s = styles(colors);

  const user = useAuthStore((st) => st.user);
  const allCommunities = useCommunityStore((st) => st.allCommunities);
  const joinedIds = useCommunityStore((st) => st.joinedIds);
  const requestedIds = useCommunityStore((st) => st.requestedIds);
  const officialCommunityIds = useCommunityStore((st) => st.officialCommunityIds);
  const hydrate = useCommunityStore((st) => st.hydrate);
  const joinCommunity = useCommunityStore((st) => st.joinCommunity);

  const businesses = useBuildStore((st) => st.businesses);
  const bookmarkedIds = useBuildStore((st) => st.bookmarkedBusinessIds);
  const loadBusinesses = useBuildStore((st) => st.loadBusinesses);
  const loadBookmarks = useBuildStore((st) => st.loadBookmarks);

  const [chip, setChip] = useState<DiscoverChip>('all');
  // Rails while she is browsing everything; a filled grid once she has chosen.
  const layout = discoverLayout(chip);
  const cardWidth = layout === 'rail'
    ? Math.round((appWidth - MARGIN - 2 * SPACE[2]) / CARDS_PER_VIEW)
    : Math.floor((appWidth - 2 * MARGIN - SPACE[2]) / 2);

  // The rail's own slice of the Archive: the top few, plus the catalogue total
  // so "Browse all N" promises the real number rather than the rail's length.
  const [archiveEntries, setArchiveEntries] = useState<ArchiveEntry[]>([]);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [archiveStatus, setArchiveStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadArchive = useCallback(async () => {
    setArchiveStatus('loading');
    try {
      // The total is a count (head request), not 200 rows measured (jank audit #4).
      const [top, total] = await Promise.all([
        fetchArchiveEntries({ sort: 'top', limit: 12 }),
        fetchArchiveTotal(),
      ]);
      setArchiveEntries(top);
      setArchiveTotal(total);
      setArchiveStatus('ready');
    } catch {
      // Both fetchers log before throwing; logging again double-reports.
      setArchiveStatus('error');
    }
  }, []);

  useEffect(() => { void loadArchive(); }, [loadArchive]);
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [economyFilter, setEconomyFilter] = useState<EconomyFilter>('all');
  const [shopsStatus, setShopsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [joinError, setJoinError] = useState<string | null>(null);

  const live = useLiveRooms();
  const events = useEvents();
  const games = useGames();
  const impact = useImpact();
  const support = useSupport();

  useEffect(() => {
    void hydrate(user?.id);
    if (user?.id) void loadBookmarks(user.id);
  }, [user?.id, hydrate, loadBookmarks]);

  // The bell badge. `fetchUnreadNotificationCount` returns 0 on any failure
  // including an unapplied migration 057, so an unknown count shows no badge
  // rather than a wrong one. Re-read on every focus, not just mount: she
  // reads or clears them on the notifications screen and comes back here.
  // src: https://reactnavigation.org/docs/6.x/use-focus-effect · @react-navigation/native 6.1.18 · 2026-10-26
  useFocusEffect(useCallback(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    void fetchUnreadNotificationCount(user.id)
      .then((n) => { if (!cancelled) setUnreadNotifications(n); })
      .catch((e: unknown) => logError(e, 'discover.unreadNotifications'));
    return () => { cancelled = true; };
  }, [user?.id]));

  const loadShops = useCallback(async () => {
    setShopsStatus('loading');
    try {
      await loadBusinesses([], economyWlwOnly(economyFilter));
      setShopsStatus('ready');
    } catch {
      setShopsStatus('error');
    }
  }, [loadBusinesses, economyFilter]);

  useEffect(() => { void loadShops(); }, [loadShops]);

  const shownEvents = useMemo(
    () => events.rows.filter((e) => eventMatchesFilter(e.event_type, eventFilter)),
    [events.rows, eventFilter],
  );

  const shownShops = useMemo(
    () => (economySavedOnly(economyFilter)
      ? businesses.filter((b) => bookmarkedIds.has(b.id))
      : businesses),
    [businesses, bookmarkedIds, economyFilter],
  );

  // "For you": the ones she has not joined lead, official communities first.
  const placedCommunities = useMemo(() => {
    const placed = officialFirst(allCommunities, officialCommunityIds ?? new Set());
    return [
      ...placed.filter((c) => !joinedIds.has(c.id)),
      ...placed.filter((c) => joinedIds.has(c.id)),
    ];
  }, [allCommunities, officialCommunityIds, joinedIds]);
  const shownCommunities = layout === 'rail'
    ? placedCommunities.slice(0, COMMUNITY_ROWS)
    : placedCommunities;

  const [topMembers, setTopMembers] = useState<TopMember[]>([]);
  const [topMembersStatus, setTopMembersStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadTopMembers = useCallback(async () => {
    setTopMembersStatus('loading');
    try {
      setTopMembers(await fetchTopMembers());
      setTopMembersStatus('ready');
    } catch (e) {
      logError(e, 'discover_topMembers');
      setTopMembersStatus('error');
    }
  }, []);

  useEffect(() => { void loadTopMembers(); }, [loadTopMembers]);
  // The card's own query is `.in('community_id', communityIds)` — the ids she
  // has joined, not the ids on screen.
  const qotdCommunityIds = useMemo(() => Array.from(joinedIds), [joinedIds]);
  const kind = economyKind(economyFilter);

  const eventPrice = (e: typeof events.rows[number]) =>
    e.is_paid && e.price_cents ? formatMoney(e.price_cents) : 'Free';

  const joinStateOf = (id: string): JoinState => {
    if (joinedIds.has(id)) return 'joined';
    if (requestedIds?.has(id)) return 'requested';
    return 'join';
  };

  const join = async (communityId: string) => {
    if (!user?.id) return;
    setJoinError(null);
    try {
      await joinCommunity(communityId, user.id);
    } catch (e) {
      logError(e, 'discover.joinCommunity');
      setJoinError('That didn’t go through. Check your connection and tap Join again.');
    }
  };

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <Text style={s.wordmark} accessibilityRole="header">Discover</Text>
          {/* The bell's only home used to be the Grow tab. It is here rather
              than on Feed because Feed is a full-bleed pager with no chrome to
              spare. */}
          <TouchableOpacity
            onPress={() => router.push('/notifications' as never)}
            accessibilityRole="button"
            accessibilityLabel={
              unreadNotifications > 0
                ? `Notifications, ${unreadNotifications} unread`
                : 'Notifications'
            }
            style={s.bell}
            testID="discover-notifications"
          >
            <Ionicons name="notifications-outline" size={ICON} color={colors.ink} />
            {unreadNotifications > 0 ? (
              <View style={s.bellDot} testID="discover-notifications-dot" />
            ) : null}
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/search')}
          accessibilityRole="button"
          accessibilityLabel="Search people, communities, events"
          style={s.search}
          testID="discover-search"
        >
          <Ionicons name="search-outline" size={ICON} color={colors.ink2} />
          <Text style={s.searchText} numberOfLines={1}>Search people, communities, events</Text>
        </TouchableOpacity>
      </View>
      <FilterChips
        chips={DISCOVER_CHIPS}
        value={chip}
        onChange={setChip}
        label="Filter Discover"
        emphasis="primary"
        testID="discover-chips"
      />

      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: FAB_LANE }]}
        showsVerticalScrollIndicator={false}
        // Roxy AI's lane (roxy-ai lane props): she tucks while this scrolls
        // down, and the list ends FAB_LANE higher so nothing parks under her.
        onScroll={onListScroll}
        // Rails that land after she came out at the end (Top 10, events on a
        // slow network) grow the list under her with no scroll event: the
        // size change re-judges her lane (lib/roxyFab, Wave 3 lane rule).
        onContentSizeChange={onListContentSizeChange}
        scrollEventThrottle={LIST_SCROLL_THROTTLE}
      >
        {railVisible(chip, 'events') ? (
          <Rail
            layout={layout}
            // "Coming up", not the board's "This week": the query is every
            // upcoming event, and a title that promised this week would lie
            // about the one three weeks out.
            title={chip === 'all' ? 'Coming up' : 'Events'}
            status={events.status}
            count={shownEvents.length}
            emptyBody={
              eventFilter === 'online'
                ? 'No online events on the calendar yet. Your communities post events here first.'
                : eventFilter === 'in_person'
                  ? 'No in-person events on the calendar yet. Your communities post events here first.'
                  : 'Nothing on the calendar yet. Your communities post events here first.'
            }
            onRetry={events.reload}
            skeleton={{ kind: 'poster', width: cardWidth }}
            testID="rail-events"
            filters={
              <FilterChips
                chips={EVENT_FILTERS}
                value={eventFilter}
                onChange={setEventFilter}
                label="Filter events"
                testID="event-chips"
              />
            }
          >
            {shownEvents.map((e) => (
              <EventPoster
                key={e.id}
                seed={e.community_name ?? e.id}
                title={e.title}
                when={format(new Date(e.starts_at), 'EEE d MMM')}
                host={e.community_name ?? 'Open to members'}
                detail={`${modeWords(e.event_type)} · ${eventPrice(e)}`}
                width={cardWidth}
                onPress={() => router.push(`/event/${e.id}` as never)}
                testID={`event-${e.id}`}
              />
            ))}
          </Rail>
        ) : null}

        {/* Near you rides with the communities rail (For you and the
            Communities chip): it is the same question, asked of a place. It
            owns its prompt, loading, empty and error states. */}
        {railVisible(chip, 'communities') ? <NearbyRail /> : null}

        {railVisible(chip, 'communities') ? (
          <Rail
            layout="list"
            title={chip === 'all' ? 'Communities for you' : 'Communities'}
            status={allCommunities.length ? 'ready' : 'loading'}
            count={shownCommunities.length}
            emptyBody="No communities yet. New ones open here first."
            onRetry={() => void hydrate(user?.id)}
            linkLabel={placedCommunities.length > shownCommunities.length || chip === 'all' ? 'See all' : undefined}
            onLinkPress={() => router.push('/communities' as never)}
            skeleton={{ kind: 'row', count: COMMUNITY_ROWS }}
            testID="rail-communities"
          >
            {joinError ? (
              <Text style={s.joinError} accessibilityLiveRegion="polite" testID="discover-join-error">
                {joinError}
              </Text>
            ) : null}
            {shownCommunities.map((c) => (
              <CommunityRow
                key={c.id}
                id={c.id}
                name={c.name}
                meta={`${officialCommunityIds?.has(c.id) ? 'Official · ' : ''}${membersLine(c.member_count)}`}
                join={joinStateOf(c.id)}
                onJoin={() => void join(c.id)}
                onPress={() => router.push(`/community/${c.id}` as never)}
                testID={`community-${c.id}`}
              />
            ))}
          </Rail>
        ) : null}

        {/* qotd: gated on a real user id — the card's own query is
            `.eq('user_id', userId)`, and an undefined id there is a query that
            quietly matches nothing rather than an error. */}
        {railVisible(chip, 'qotd') && user?.id ? (
          <View style={s.qotd} testID="rail-qotd">
            <QuestionOfTheDayCard communityIds={qotdCommunityIds} userId={user.id} />
          </View>
        ) : null}

        {/* The Archive: its own rail (lane moments owns the covers). */}
        {railVisible(chip, 'archive') ? (
          <ArchiveRail
            entries={archiveEntries}
            total={archiveTotal}
            status={archiveStatus}
            onRetry={() => void loadArchive()}
            onPressEntry={(entry) => router.push(archiveDetailPath(entry.slug) as never)}
            onSeeAll={() => router.push('/archive' as never)}
          />
        ) : null}

        {railVisible(chip, 'live') ? (
          <Rail
            layout="list"
            title="Live now"
            status={live.status}
            count={live.rows.length}
            emptyBody="Nothing live right now. Rooms open through the day."
            onRetry={live.reload}
            skeleton={{ kind: 'row' }}
            testID="rail-live"
          >
            {live.rows.map((room) => (
              <LiveRow
                key={room.id}
                seed={room.community_name ?? room.name}
                title={room.community_name ? `${room.name} · ${room.community_name}` : room.name}
                count={`${room.participant_count} ${room.room_type === 'audio' ? 'listening' : 'watching'}`}
                onPress={() => router.push(`/community-room-session?room_id=${room.id}` as never)}
                testID={`live-${room.id}`}
              />
            ))}
          </Rail>
        ) : null}

        {railVisible(chip, 'economy') ? (
          <Rail
            layout={layout}
            title="Shops"
            status={kind === 'shops' ? shopsStatus : kind === 'impact' ? impact.status : support.status}
            count={kind === 'shops' ? shownShops.length : kind === 'impact' ? impact.rows.length : support.rows.length}
            emptyBody={
              kind === 'impact'
                ? 'No impact projects yet.'
                : kind === 'support'
                  ? 'No ideas pitched yet. Yours could be first.'
                  : economySavedOnly(economyFilter)
                    ? 'Nothing saved yet. Tap the heart on any shop.'
                    : 'No shops here yet.'
            }
            onRetry={kind === 'shops' ? () => void loadShops() : kind === 'impact' ? impact.reload : support.reload}
            skeleton={kind === 'support' ? { kind: 'row' } : { kind: 'tile', width: cardWidth }}
            testID="rail-economy"
            filters={
              <FilterChips
                chips={ECONOMY_FILTERS}
                value={economyFilter}
                onChange={setEconomyFilter}
                label="Filter shops"
                testID="economy-chips"
              />
            }
          >
            {kind === 'shops' && shownShops.map((b) => (
              <TileCard
                key={b.id}
                seed={b.name}
                title={b.name}
                meta={b.location_city ?? b.category ?? 'WLW-owned'}
                width={cardWidth}
                onPress={() => router.push(`/business/${b.id}` as never)}
                testID={`shop-${b.id}`}
              />
            ))}
            {kind === 'impact' && impact.rows.map((p) => (
              <TileCard
                key={p.id}
                seed={p.title}
                title={p.title}
                meta={`${p.supporter_count} supporters`}
                width={cardWidth}
                onPress={() => router.push('/support' as never)}
                testID={`impact-${p.id}`}
              />
            ))}
            {kind === 'support' && support.rows.map((f) => (
              <ListRow
                key={f.id}
                icon="bulb-outline"
                seed={f.title}
                title={f.title}
                subtitle={`${f.vote_count} votes${f.type === 'planned' ? ' · Roxy pick' : ''}`}
                onPress={() => router.push('/support' as never)}
                testID={`support-${f.id}`}
              />
            ))}
          </Rail>
        ) : null}

        {railVisible(chip, 'games') ? (
          <Rail
            layout="list"
            title="Games"
            status={games.status}
            count={games.rows.length}
            emptyBody="No games yet. New ones land here first."
            onRetry={games.reload}
            skeleton={{ kind: 'row' }}
            testID="rail-games"
          >
            {games.rows.map((g) => (
              <ListRow
                key={g.id}
                icon="game-controller-outline"
                seed={g.name}
                title={g.name}
                subtitle={g.short_description}
                onPress={() => {
                  // Speed Dating is a native route, not a WebView game.
                  if (g.name === 'Speed Dating') { router.push('/speed-dating' as never); return; }
                  if (isPlayableGameUrl(g.url)) {
                    router.push(`/(tabs)/discover/games/${g.id}` as never);
                  }
                }}
                testID={`game-${g.id}`}
              />
            ))}
          </Rail>
        ) : null}

        {railVisible(chip, 'top10') ? (
          <Rail
            layout={layout}
            title="Top 10 members"
            status={topMembersStatus}
            count={topMembers.length}
            emptyBody="Nobody on the board yet."
            onRetry={() => void loadTopMembers()}
            skeleton={{ kind: 'member', width: cardWidth }}
            testID="rail-top10"
          >
            {topMembers.map((m, i) => (
              <MemberCard
                key={m.id}
                rank={i + 1}
                name={memberName(m)}
                // The staff tag when there is one — it is the editorial reason
                // she is on the chart. Points otherwise.
                subtitle={memberSubtitle(m)}
                avatarUrl={m.avatar_url}
                seed={m.id}
                width={cardWidth}
                onPress={() => router.push(`/user/${m.id}` as never)}
                testID={`top10-${m.id}`}
              />
            ))}
          </Rail>
        ) : null}

        {/* Clears the floating tab bar and the Roxy FAB. */}
        <View style={s.tail} />
      </ScrollView>
    </SafeAreaView>
  );
}

// Built once per theme, not on every render (jank audit #8).
const styles = byTheme((colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  header: {
    paddingHorizontal: MARGIN, paddingTop: SPACE[2], paddingBottom: SPACE[1], gap: SPACE[2],
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { ...TYPE.headline, color: colors.ink, flex: 1 },
  bell: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center', marginRight: -SPACE[2],
  },
  bellDot: {
    position: 'absolute', top: SPACE[2], right: SPACE[2],
    width: SPACE[1], height: SPACE[1], borderRadius: RADII.pill,
    backgroundColor: colors.pink,
  },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    height: SEARCH_HEIGHT, paddingHorizontal: SPACE[4],
    borderRadius: RADII.pill, backgroundColor: colors.raised,
  },
  searchText: { ...TYPE.body, color: colors.ink2, flex: 1 },
  joinError: { ...TYPE.meta, color: colors.dangerInk, paddingHorizontal: MARGIN },
  body: { paddingBottom: 8 },
  qotd: { marginHorizontal: MARGIN, marginTop: SPACE[5] },
  tail: { height: 120 },
}));

export default function DiscoverRoute() {
  return (
    <FeatureGate feature="discover">
      <DiscoverScreen />
    </FeatureGate>
  );
}
