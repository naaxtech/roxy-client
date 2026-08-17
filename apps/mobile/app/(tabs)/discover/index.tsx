import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useAuthStore } from '../../../store/authStore';
import { useCommunityStore } from '../../../store/communityStore';
import { useBuildStore } from '../../../store/buildStore';
import { TYPE } from '../../../lib/typography';
import { RADII, type ThemeColors } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { formatMoney } from '../../../lib/currency';
import { isPlayableGameUrl } from '../../../lib/gameUrl';
import { Rail } from '../../../components/discover/Rail';
import { FilterChips } from '../../../components/discover/FilterChips';
import { PosterCard, RowCard, HeroCard } from '../../../components/discover/DiscoverCards';
import {
  DISCOVER_CHIPS, EVENT_FILTERS, ECONOMY_FILTERS,
  railVisible, eventMatchesFilter, economyKind, economyWlwOnly, economySavedOnly,
  type DiscoverChip, type EventFilter, type EconomyFilter,
} from '../../../components/discover/discoverFilters';
import {
  useLiveRooms, useEvents, useGames, useImpact, useSupport,
} from '../../../components/discover/useDiscoverData';

/**
 * Discover — search-first, then rails.
 *
 * This screen replaces three things at once: the old Play tab (games + rooms),
 * the Build directory, and Connect's browse. The rails are the seam that makes
 * that possible — each one is a category that used to be a tab, and the top chip
 * row is the tab bar those tabs left behind.
 *
 * Every rail owns its own loading, empty and error state through `Rail`, and
 * every rail loads independently — one slow edge function must not hold up six
 * rails that already have their data. `discoverFilters.ts` owns which rails are
 * on screen; this file only asks.
 */
export default function DiscoverScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const s = styles(colors);

  const user = useAuthStore((st) => st.user);
  const allCommunities = useCommunityStore((st) => st.allCommunities);
  const joinedIds = useCommunityStore((st) => st.joinedIds);
  const hydrate = useCommunityStore((st) => st.hydrate);

  const businesses = useBuildStore((st) => st.businesses);
  const bookmarkedIds = useBuildStore((st) => st.bookmarkedBusinessIds);
  const loadBusinesses = useBuildStore((st) => st.loadBusinesses);
  const loadBookmarks = useBuildStore((st) => st.loadBookmarks);

  const [chip, setChip] = useState<DiscoverChip>('all');
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [economyFilter, setEconomyFilter] = useState<EconomyFilter>('all');
  const [shopsStatus, setShopsStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const live = useLiveRooms();
  const events = useEvents();
  const games = useGames();
  const impact = useImpact();
  const support = useSupport();

  useEffect(() => {
    void hydrate(user?.id);
    if (user?.id) void loadBookmarks(user.id);
  }, [user?.id, hydrate, loadBookmarks]);

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

  const top10 = useMemo(() => allCommunities.slice(0, 10), [allCommunities]);
  const heroEvent = shownEvents[0] ?? events.rows[0] ?? null;
  const kind = economyKind(economyFilter);

  const eventMeta = (e: typeof events.rows[number]) => {
    const when = format(new Date(e.starts_at), 'EEE d MMM · h:mm a');
    const where = e.location_text ?? e.community_name ?? 'Online';
    return `${when} · ${where}`;
  };

  const eventPrice = (e: typeof events.rows[number]) =>
    e.is_paid && e.price_cents ? formatMoney(e.price_cents) : 'Free';

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <View style={s.header}>
        <Text style={s.wordmark} accessibilityRole="header">Discover</Text>
        <TouchableOpacity
          onPress={() => router.push('/search')}
          accessibilityRole="button"
          accessibilityLabel="Search Roxy"
          activeOpacity={0.85}
          style={s.search}
          testID="discover-search"
        >
          <Ionicons name="search" size={17} color={colors.textSecondary} />
          <Text style={s.searchText}>Search communities, people, events…</Text>
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

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        {railVisible(chip, 'hero') && heroEvent ? (
          <HeroCard
            badge={heroEvent.event_type === 'online' ? 'online' : 'inPerson'}
            title={heroEvent.title}
            meta={eventMeta(heroEvent)}
            body={heroEvent.community_name ? `Hosted by ${heroEvent.community_name}` : 'Open to members'}
            cta={heroEvent.is_paid ? 'Get a ticket' : 'RSVP — it’s free'}
            artSeed={heroEvent.id}
            onPress={() => router.push(`/event/${heroEvent.id}` as never)}
          />
        ) : null}

        {railVisible(chip, 'top10') ? (
          <Rail
            title="Top 10 communities"
            status={allCommunities.length ? 'ready' : 'loading'}
            count={top10.length}
            emptyBody="No communities yet — yours could be the first."
            onRetry={() => void hydrate(user?.id)}
            testID="rail-top10"
          >
            {top10.map((c, i) => (
              <PosterCard
                key={c.id}
                rank={i + 1}
                title={c.name}
                subtitle={`${c.member_count} members`}
                badge="community"
                artSeed={c.name}
                onPress={() => router.push(`/community/${c.id}` as never)}
                testID={`top10-${c.id}`}
              />
            ))}
          </Rail>
        ) : null}

        {railVisible(chip, 'live') ? (
          <Rail
            title="Live now"
            status={live.status}
            count={live.rows.length}
            emptyBody="Nothing live right now. Rooms open through the day."
            onRetry={live.reload}
            testID="rail-live"
          >
            {live.rows.map((room) => (
              <RowCard
                key={room.id}
                icon={room.room_type === 'audio' ? 'mic' : 'videocam'}
                badge="live"
                title={room.name}
                subtitle={`${room.participant_count} in${room.community_name ? ` · ${room.community_name}` : ''}`}
                artSeed={room.name}
                onPress={() => router.push(`/community-room-session?room_id=${room.id}` as never)}
                testID={`live-${room.id}`}
              />
            ))}
          </Rail>
        ) : null}

        {railVisible(chip, 'events') ? (
          <Rail
            title="Events"
            status={events.status}
            count={shownEvents.length}
            emptyBody={
              eventFilter === 'online'
                ? 'No online events on the calendar yet.'
                : eventFilter === 'in_person'
                  ? 'No in-person events on the calendar yet.'
                  : 'Nothing on the calendar yet.'
            }
            onRetry={events.reload}
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
              <PosterCard
                key={e.id}
                title={e.title}
                subtitle={`${eventPrice(e)} · ${eventMeta(e)}`}
                badge={e.event_type === 'online' ? 'online' : 'inPerson'}
                artSeed={e.id}
                onPress={() => router.push(`/event/${e.id}` as never)}
                testID={`event-${e.id}`}
              />
            ))}
          </Rail>
        ) : null}

        {railVisible(chip, 'economy') ? (
          <Rail
            title="WLW economy"
            status={kind === 'shops' ? shopsStatus : kind === 'impact' ? impact.status : support.status}
            count={kind === 'shops' ? shownShops.length : kind === 'impact' ? impact.rows.length : support.rows.length}
            emptyBody={
              kind === 'impact'
                ? 'No impact projects yet.'
                : kind === 'support'
                  ? 'No ideas pitched yet — yours could be first.'
                  : economySavedOnly(economyFilter)
                    ? 'Nothing saved yet. Tap the heart on any shop.'
                    : 'No shops here yet.'
            }
            onRetry={kind === 'shops' ? () => void loadShops() : kind === 'impact' ? impact.reload : support.reload}
            testID="rail-economy"
            filters={
              <FilterChips
                chips={ECONOMY_FILTERS}
                value={economyFilter}
                onChange={setEconomyFilter}
                label="Filter the WLW economy"
                testID="economy-chips"
              />
            }
          >
            {kind === 'shops' && shownShops.map((b) => (
              <PosterCard
                key={b.id}
                title={b.name}
                subtitle={b.location_city ?? b.category ?? 'WLW-owned'}
                badge="shop"
                artSeed={b.name}
                onPress={() => router.push(`/business/${b.id}` as never)}
                testID={`shop-${b.id}`}
              />
            ))}
            {kind === 'impact' && impact.rows.map((p) => (
              <PosterCard
                key={p.id}
                title={p.title}
                subtitle={`${p.supporter_count} supporters`}
                badge="impact"
                artSeed={p.title}
                onPress={() => router.push('/support' as never)}
                testID={`impact-${p.id}`}
              />
            ))}
            {kind === 'support' && support.rows.map((f) => (
              <RowCard
                key={f.id}
                icon="bulb-outline"
                title={f.title}
                subtitle={`${f.vote_count} votes${f.type === 'planned' ? ' · Roxy pick' : ''}`}
                artSeed={f.title}
                onPress={() => router.push('/support' as never)}
                testID={`support-${f.id}`}
              />
            ))}
          </Rail>
        ) : null}

        {railVisible(chip, 'communities') ? (
          <Rail
            title="Communities"
            status={allCommunities.length ? 'ready' : 'loading'}
            count={allCommunities.length}
            emptyBody="No communities yet."
            onRetry={() => void hydrate(user?.id)}
            testID="rail-communities"
          >
            {allCommunities.slice(0, 12).map((c) => (
              <PosterCard
                key={c.id}
                title={c.name}
                subtitle={`${c.member_count} members${joinedIds.has(c.id) ? ' · joined' : ''}`}
                badge="community"
                artSeed={c.name}
                onPress={() => router.push(`/community/${c.id}` as never)}
                testID={`community-${c.id}`}
              />
            ))}
          </Rail>
        ) : null}

        {railVisible(chip, 'games') ? (
          <Rail
            title="Games"
            status={games.status}
            count={games.rows.length}
            emptyBody="No games yet."
            onRetry={games.reload}
            testID="rail-games"
          >
            {games.rows.map((g) => (
              <RowCard
                key={g.id}
                icon="game-controller"
                badge="game"
                title={g.name}
                subtitle={g.short_description}
                artSeed={g.name}
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

        {/* Clears the floating tab bar and the Roxy FAB. */}
        <View style={s.tail} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  wordmark: { ...TYPE.display, color: colors.textPrimary },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 14,
    borderRadius: RADII.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  searchText: { ...TYPE.caption, color: colors.textSecondary },
  body: { paddingBottom: 8 },
  tail: { height: 120 },
});
