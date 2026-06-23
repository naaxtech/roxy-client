import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, Dimensions, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { format, addHours } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';

const SCREEN_W = Dimensions.get('window').width;
// Matches grow/index.tsx's scroll contentContainerStyle padding — this card has no
// margin of its own, so it lines up flush with sibling section cards.
const PARENT_PADDING = 12;
const SLIDE_WIDTH = SCREEN_W - PARENT_PADDING * 2;

type HappeningItem =
  | { kind: 'event'; id: string; title: string; communityName: string; startsAt: string; attendeeCount: number; spotsLeft: number | null }
  | { kind: 'room'; id: string; name: string; communityName: string; participantCount: number | null }
  | { kind: 'game'; id: string; title: string; communityName: string };

interface Props {
  communityIds: string[];
}

function pad(n: number) { return String(n).padStart(2, '0'); }

function Countdown({ startsAt }: { startsAt: string }) {
  const colors = useThemeColors();
  const [secs, setSecs] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(startsAt).getTime();
    const tick = () => setSecs(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startsAt]);

  const started = new Date(startsAt) <= new Date();
  if (started) return <Text style={[s.liveLabel, { color: colors.error }]}>● LIVE</Text>;
  if (secs === null) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const sc = secs % 60;
  return (
    <View>
      <Text style={[s.countdownLabel, { color: 'rgba(255,255,255,0.7)' }]}>STARTS IN</Text>
      <Text style={[s.countdown, { color: '#fff' }]}>
        {pad(h)} : {pad(m)} : {pad(sc)}
      </Text>
    </View>
  );
}

function LivePulse({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.3, duration: 750, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  return <Animated.View style={[s.liveDot, { backgroundColor: color, opacity: anim }]} />;
}

export function HappeningTonightCard({ communityIds }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const [items, setItems] = useState<HappeningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  const load = useCallback(async () => {
    if (communityIds.length === 0) { setLoading(false); return; }
    const now = new Date().toISOString();
    const tonightEnd = addHours(new Date(), 24).toISOString();
    try {
      const [roomsRes, eventsRes, gamesRes] = await Promise.all([
        supabase.from('community_rooms').select('id, name, communities(name)')
          .in('community_id', communityIds).eq('status', 'live').eq('is_active', true).limit(5),
        supabase.from('events').select('id, title, starts_at, communities(name)')
          .in('community_id', communityIds).gte('starts_at', now).lte('starts_at', tonightEnd)
          .eq('is_private', false).order('starts_at', { ascending: true }).limit(5),
        supabase.from('community_games').select('id, communities(name), games!inner(id, name, status)')
          .in('community_id', communityIds).eq('games.status', 'live').limit(3),
      ]);

      const rooms: HappeningItem[] = (roomsRes.data ?? []).map((r: any) => ({
        kind: 'room', id: r.id, name: r.name,
        communityName: r.communities?.name ?? '', participantCount: null,
      }));
      const events: HappeningItem[] = (eventsRes.data ?? []).map((e: any) => ({
        kind: 'event', id: e.id, title: e.title,
        communityName: e.communities?.name ?? '', startsAt: e.starts_at,
        attendeeCount: 0, spotsLeft: null,
      }));
      const games: HappeningItem[] = (gamesRes.data ?? []).map((g: any) => ({
        kind: 'game', id: g.id, title: g.games.name,
        communityName: g.communities?.name ?? '',
      }));
      setItems([...rooms, ...events, ...games]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [communityIds]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View style={[s.outer, { borderColor: colors.roxy }]}>
        <ActivityIndicator color="#fff" style={{ padding: 48 }} />
      </View>
    );
  }
  if (items.length === 0) return null;

  const renderSlide = ({ item }: { item: HappeningItem }) => (
    <View style={[s.slide, { width: SLIDE_WIDTH }]}>
      {item.kind === 'room' && (
        <>
          <View style={s.itemHeader}>
            <LivePulse color={colors.error} />
            <Text style={s.itemBadge}>LIVE</Text>
          </View>
          <Text style={s.itemTitle} numberOfLines={2}>{item.name}</Text>
          <Text style={s.itemMeta}>{item.communityName}</Text>
          <TouchableOpacity style={s.joinBtn} onPress={() => router.push(`/room/${item.id}` as any)}>
            <Text style={s.joinBtnText}>Join now</Text>
          </TouchableOpacity>
        </>
      )}
      {item.kind === 'event' && (
        <>
          <Text style={s.itemTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={s.itemMeta}>
            {item.communityName} · {format(new Date(item.startsAt), 'h:mm a')}
          </Text>
          <View style={s.eventBottom}>
            <TouchableOpacity style={s.joinBtn} onPress={() => router.push(`/event/${item.id}` as any)}>
              <Text style={s.joinBtnText}>Join now</Text>
            </TouchableOpacity>
            <Countdown startsAt={item.startsAt} />
          </View>
        </>
      )}
      {item.kind === 'game' && (
        <>
          <Text style={s.itemBadge}>Available now</Text>
          <Text style={s.itemTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={s.itemMeta}>{item.communityName}</Text>
          <TouchableOpacity style={s.joinBtn} onPress={() => router.push('/(tabs)/discover' as any)}>
            <Text style={s.joinBtnText}>Play now</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  return (
    <View style={[s.outer, { borderColor: colors.roxy }]}>
      <Text style={s.sectionLabel}>HAPPENING TONIGHT</Text>
      <FlatList
        data={items}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        renderItem={renderSlide}
        horizontal
        nestedScrollEnabled
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={SLIDE_WIDTH}
        decelerationRate="fast"
        disableIntervalMomentum
        onMomentumScrollEnd={(e) => {
          setCurrentIndex(Math.round(e.nativeEvent.contentOffset.x / SLIDE_WIDTH));
        }}
        getItemLayout={(_, i) => ({ length: SLIDE_WIDTH, offset: SLIDE_WIDTH * i, index: i })}
      />
      {items.length > 1 && (
        <View style={s.dots}>
          {items.map((_, i) => (
            <View key={i} style={[s.dot, i === currentIndex && s.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const PINK = '#C4476A';

const s = StyleSheet.create({
  outer: {
    borderWidth: 2,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: PINK,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
  },
  slide: {
    minHeight: 140,
    paddingHorizontal: 16,
    paddingBottom: 14,
    justifyContent: 'space-between',
  },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  itemBadge: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: 'rgba(255,255,255,0.85)' },
  itemTitle: { fontSize: 17, fontWeight: '800', lineHeight: 22, marginVertical: 4, color: '#fff' },
  itemMeta: { fontSize: 12, marginBottom: 8, color: 'rgba(255,255,255,0.75)' },
  eventBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  joinBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
  },
  joinBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  countdownLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textAlign: 'right' },
  countdown: { fontSize: 16, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  liveLabel: { fontSize: 13, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 4, justifyContent: 'center', paddingBottom: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: '#fff' },
});
