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

type LiveRoom = {
  id: string;
  name: string;
  participant_count: number;
  community_name: string | null;
};

type Status = 'loading' | 'ready' | 'error';

interface Props {
  /** Collapsed until she asks — the rail is an offer, not an interruption. */
  open: boolean;
  onCount: (n: number) => void;
}

/**
 * "Happening now" — the live rooms rail in the feed header.
 *
 * This is where Grow's Happening Tonight card lands. It is deliberately
 * collapsed by default: a feed is a place you fall into, and a strip of things
 * demanding attention above it undoes that. The count rides on the toggle so a
 * viewer can decide whether it is worth opening.
 *
 * LIVE is a dot AND the word, never the gradient alone — colour is not a state.
 * `LIVE_GRADIENT` is licensed here because this is exactly what it is reserved
 * for; its ink comes from `inkOn()`, not from a hardcoded white.
 */
export function NowRail({ open, onCount }: Props) {
  const router = useRouter();
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [status, setStatus] = useState<Status>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    const { data, error } = await supabase
      .from('community_rooms')
      .select('id, name, participant_count, communities(name)')
      .eq('is_active', true)
      .eq('status', 'live')
      .order('participant_count', { ascending: false })
      .limit(8);

    if (error) {
      logError(error, 'NowRail.load');
      setStatus('error');
      return;
    }

    const rows: LiveRoom[] = (data ?? []).map((r) => {
      const raw = r as unknown as {
        id: string;
        name: string;
        participant_count: number | null;
        communities: { name: string } | null;
      };
      return {
        id: raw.id,
        name: raw.name,
        participant_count: raw.participant_count ?? 0,
        community_name: raw.communities?.name ?? null,
      };
    });
    setRooms(rows);
    onCount(rows.length);
    setStatus('ready');
  }, [onCount]);

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
        <Text style={s.stateText}>Could not reach live rooms.</Text>
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

  if (rooms.length === 0) {
    return (
      <View style={s.state} testID="now-rail-empty">
        <Text style={s.stateText}>Nothing live right now — you could start one.</Text>
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
      {rooms.map((room) => (
        <TouchableOpacity
          key={room.id}
          testID={`now-rail-room-${room.id}`}
          onPress={() => router.push(`/community-room-session?room_id=${room.id}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`Join ${room.name}, live now with ${room.participant_count} in the room`}
          activeOpacity={0.85}
          style={s.card}
        >
          <LinearGradient colors={LIVE_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.pill}>
            <View style={[s.dot, { backgroundColor: inkOn(LIVE_GRADIENT[1]) }]} />
            <Text style={[s.pillText, { color: inkOn(LIVE_GRADIENT[1]) }]}>LIVE</Text>
          </LinearGradient>
          <Text style={s.name} numberOfLines={1}>{room.name}</Text>
          <Text style={s.meta} numberOfLines={1}>
            {room.participant_count} in{room.community_name ? ` · ${room.community_name}` : ''}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
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
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { ...TYPE.micro, fontWeight: '800' },
  name: { ...TYPE.caption, color: STAGE.textPrimary, fontWeight: '700' },
  meta: { ...TYPE.micro, color: STAGE.textSecondary },
  state: { paddingVertical: 14, paddingHorizontal: 4, gap: 6, alignItems: 'flex-start' },
  stateText: { ...TYPE.caption, color: STAGE.textSecondary },
  retryHit: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  retry: { ...TYPE.caption, color: STAGE.primaryInk, fontWeight: '700' },
});
