import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';
import { STAGE } from './stageColors';
import { TYPE } from '../../lib/typography';
import { RADII, LIVE_GRADIENT, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import {
  nowScope, happeningWindow, mergeHappening, NOW_CAPS,
  type HappeningItem, type NowScope,
} from './happeningNow';

type Status = 'loading' | 'ready' | 'error';

interface Props {
  /** Collapsed until she asks — the rail is an offer, not an interruption. */
  open: boolean;
  /** The communities she has joined. Empty means she sees Roxy-wide instead. */
  communityIds: string[];
  onCount: (n: number) => void;
}

/**
 * "Happening now" — the live rail in the feed header.
 *
 * This is where Grow's Happening Tonight card landed, and for one commit it
 * landed only halfway: the card asked three tables for what was live or
 * starting within 24 hours *in the communities she had joined*, and the rail
 * that replaced it asked one table for every live room on Roxy with no window.
 * Reachable content, different product. The scoping is back — rooms, games and
 * events, hers first — with the decision itself in `happeningNow.ts` where a
 * test can see it.
 *
 * Deliberately collapsed by default: a feed is a place you fall into, and a
 * strip of things demanding attention above it undoes that. The count rides on
 * the toggle so a viewer can decide whether it is worth opening.
 *
 * LIVE is a dot AND the word, never the gradient alone — colour is not a state.
 * `LIVE_GRADIENT` is licensed here because this is exactly what it is reserved
 * for; its ink comes from `inkOn()`, not from a hardcoded white.
 */
export function NowRail({ open, communityIds, onCount }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<HappeningItem[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [scope, setScope] = useState<NowScope['kind']>('global');

  // The identity of `communityIds` changes on every store read; its contents
  // are what the query depends on.
  const scopeKey = communityIds.join(',');

  const load = useCallback(async () => {
    setStatus('loading');
    const current = nowScope(scopeKey === '' ? [] : scopeKey.split(','));
    setScope(current.kind);

    if (current.kind === 'global') {
      // She has joined nothing yet. A live room is already "now", so there is
      // no window to apply — and no community to scope to.
      const { data, error } = await supabase
        .from('community_rooms')
        .select('id, name, participant_count, communities(name)')
        .eq('is_active', true)
        .eq('status', 'live')
        .order('participant_count', { ascending: false })
        .limit(NOW_CAPS.room);

      if (error) {
        logError(error, 'NowRail.load.global');
        setStatus('error');
        return;
      }
      const rows = mergeHappening((data ?? []).map(toRoom));
      setItems(rows);
      onCount(rows.length);
      setStatus('ready');
      return;
    }

    const { fromISO, toISO } = happeningWindow(new Date());
    const [roomsRes, gamesRes, eventsRes] = await Promise.all([
      supabase
        .from('community_rooms')
        .select('id, name, participant_count, communities(name)')
        .in('community_id', current.communityIds)
        .eq('is_active', true)
        .eq('status', 'live')
        .order('participant_count', { ascending: false })
        .limit(NOW_CAPS.room),
      supabase
        .from('community_games')
        .select('communities(name), games!inner(id, name, status)')
        .in('community_id', current.communityIds)
        .eq('games.status', 'live')
        .limit(NOW_CAPS.game),
      supabase
        .from('events')
        .select('id, title, starts_at, communities(name)')
        .in('community_id', current.communityIds)
        .eq('is_private', false)
        .gte('starts_at', fromISO)
        .lte('starts_at', toISO)
        .order('starts_at', { ascending: true })
        .limit(NOW_CAPS.event),
    ]);

    // One source failing is not the rail failing. The card this replaces
    // swallowed all three into `setItems([])` inside a bare `catch`, so a
    // broken query and a quiet night looked identical — to her and to us.
    if (roomsRes.error) logError(roomsRes.error, 'NowRail.load.rooms');
    if (gamesRes.error) logError(gamesRes.error, 'NowRail.load.games');
    if (eventsRes.error) logError(eventsRes.error, 'NowRail.load.events');

    if (roomsRes.error && gamesRes.error && eventsRes.error) {
      setStatus('error');
      return;
    }

    const rows = mergeHappening([
      ...(roomsRes.data ?? []).map(toRoom),
      ...(gamesRes.data ?? []).map(toGame),
      ...(eventsRes.data ?? []).map(toEvent),
    ]);
    setItems(rows);
    onCount(rows.length);
    setStatus('ready');
  }, [scopeKey, onCount]);

  useEffect(() => { void load(); }, [load]);

  if (!open) return null;

  if (status === 'loading') {
    return (
      <View style={s.state} testID="now-rail-loading">
        <ActivityIndicator color={STAGE.primaryInk} />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={s.state} testID="now-rail-error">
        <Text style={s.stateText}>Could not reach what is happening now.</Text>
        <TouchableOpacity
          onPress={() => void load()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={s.retryHit}
        >
          <Text style={s.retry}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={s.state} testID="now-rail-empty">
        <Text style={s.stateText}>
          {scope === 'communities'
            ? 'Nothing on in your communities tonight — you could start something.'
            : 'Nothing live right now — join a community to see what yours are doing.'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.rail}
      testID="now-rail"
    >
      {items.map((item) => (
        <TouchableOpacity
          key={`${item.kind}-${item.id}`}
          testID={`now-rail-${item.kind}-${item.id}`}
          onPress={() => router.push(routeFor(item) as never)}
          accessibilityRole="button"
          accessibilityLabel={labelFor(item)}
          activeOpacity={0.85}
          style={s.card}
        >
          {item.kind === 'event' ? (
            <View style={s.soonPill}>
              <Text style={s.soonText}>TONIGHT</Text>
            </View>
          ) : (
            <LinearGradient colors={LIVE_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.pill}>
              <View style={[s.dot, { backgroundColor: inkOn(LIVE_GRADIENT[1]) }]} />
              <Text style={[s.pillText, { color: inkOn(LIVE_GRADIENT[1]) }]}>LIVE</Text>
            </LinearGradient>
          )}
          <Text style={s.name} numberOfLines={1}>{item.title}</Text>
          <Text style={s.meta} numberOfLines={1}>{metaFor(item)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

type RoomRow = { id: string; name: string; participant_count: number | null; communities: { name: string } | null };
type GameRow = { communities: { name: string } | null; games: { id: string; name: string } | null };
type EventRow = { id: string; title: string; starts_at: string; communities: { name: string } | null };

function toRoom(row: unknown): HappeningItem {
  const r = row as RoomRow;
  return {
    kind: 'room',
    id: r.id,
    title: r.name,
    communityName: r.communities?.name ?? null,
    participantCount: r.participant_count ?? 0,
  };
}

function toGame(row: unknown): HappeningItem {
  const g = row as GameRow;
  // The game's own id, not the `community_games` join row's — the games route
  // is keyed on `games.id`, and the card this replaces navigated with the join
  // id, which cannot resolve.
  return {
    kind: 'game',
    id: g.games?.id ?? '',
    title: g.games?.name ?? 'Game',
    communityName: g.communities?.name ?? null,
  };
}

function toEvent(row: unknown): HappeningItem {
  const e = row as EventRow;
  return {
    kind: 'event',
    id: e.id,
    title: e.title,
    communityName: e.communities?.name ?? null,
    startsAt: e.starts_at,
  };
}

function routeFor(item: HappeningItem): string {
  if (item.kind === 'room') return `/community-room-session?room_id=${item.id}`;
  if (item.kind === 'game') return `/(tabs)/discover/games/${item.id}`;
  return `/event/${item.id}`;
}

function inCommunity(item: HappeningItem): string {
  return item.communityName ? ` in ${item.communityName}` : '';
}

function labelFor(item: HappeningItem): string {
  if (item.kind === 'room') {
    return `Join ${item.title}, live now${inCommunity(item)} with ${item.participantCount} in the room`;
  }
  if (item.kind === 'game') return `Play ${item.title}, live now${inCommunity(item)}`;
  return `Open ${item.title}, starting tonight${inCommunity(item)}`;
}

function metaFor(item: HappeningItem): string {
  const where = item.communityName ?? '';
  if (item.kind === 'room') return `${item.participantCount} in${where ? ` · ${where}` : ''}`;
  if (item.kind === 'game') return `Playing now${where ? ` · ${where}` : ''}`;
  return `${startsAtLabel(item.startsAt)}${where ? ` · ${where}` : ''}`;
}

function startsAtLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Tonight';
  const hh = at.getHours();
  const mm = at.getMinutes();
  const suffix = hh < 12 ? 'am' : 'pm';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm === 0 ? `${h12}${suffix}` : `${h12}:${String(mm).padStart(2, '0')}${suffix}`;
}

const s = StyleSheet.create({
  rail: { gap: 10, paddingHorizontal: 4, paddingVertical: 8 },
  card: {
    width: 168,
    gap: 4,
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: STAGE.surface,
    borderWidth: 1,
    borderColor: STAGE.line,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.pill,
  },
  // An event is not live, so it does not get the live gradient. Same shape,
  // stated in words, in the stage's own ink.
  soonPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: STAGE.line,
  },
  soonText: { ...TYPE.micro, fontWeight: '800', color: STAGE.textSecondary },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { ...TYPE.micro, fontWeight: '800' },
  name: { ...TYPE.caption, color: STAGE.textPrimary, fontWeight: '700' },
  meta: { ...TYPE.micro, color: STAGE.textSecondary },
  state: { paddingVertical: 14, paddingHorizontal: 4, gap: 6, alignItems: 'flex-start' },
  stateText: { ...TYPE.caption, color: STAGE.textSecondary },
  retryHit: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  retry: { ...TYPE.caption, color: STAGE.primaryInk, fontWeight: '700' },
});
