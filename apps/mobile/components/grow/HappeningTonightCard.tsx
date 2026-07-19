import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, addHours } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';

const AUTO_ADVANCE_MS = 4500;

type HappeningItem =
  | { kind: 'event'; id: string; title: string; communityName: string; startsAt: string }
  | { kind: 'room'; id: string; name: string; communityName: string; participantCount: number | null }
  | { kind: 'game'; id: string; title: string; communityName: string };

interface Props {
  communityIds: string[];
}

function pad(n: number) { return String(n).padStart(2, '0'); }

/** Peg-style boxed countdown: STARTS IN [04]:[46]:[21] HRS MIN SEC. */
function Countdown({ startsAt }: { startsAt: string }) {
  const [secs, setSecs] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(startsAt).getTime();
    const tick = () => setSecs(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startsAt]);

  if (new Date(startsAt) <= new Date()) {
    return (
      <View style={s.livePill}>
        <LivePulse />
        <Text style={s.livePillText}>LIVE</Text>
      </View>
    );
  }
  if (secs === null) return null;
  const units = [
    { v: Math.floor(secs / 3600), l: 'HRS' },
    { v: Math.floor((secs % 3600) / 60), l: 'MIN' },
    { v: secs % 60, l: 'SEC' },
  ];
  return (
    <View>
      <Text style={s.countdownLabel}>STARTS IN</Text>
      <View style={s.countdownRow}>
        {units.map((u, i) => (
          <View key={u.l} style={s.countdownUnit}>
            <View style={s.countdownBox}>
              <Text style={s.countdownDigits}>{pad(u.v)}</Text>
            </View>
            <Text style={s.countdownUnitLabel}>{u.l}</Text>
            {i < 2 && <View style={s.countdownColonSpacer} />}
          </View>
        ))}
      </View>
    </View>
  );
}

function LivePulse() {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.3, duration: 750, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  return <Animated.View style={[s.liveDot, { opacity: anim }]} />;
}

/**
 * Jo's peg (roxy-home-v1): full brand-gradient card, white circle flash
 * plate, HAPPENING TONIGHT pill, boxed countdown, solid white Join CTA —
 * as an auto-moving carousel of everything live/tonight in your communities.
 */
export function HappeningTonightCard({ communityIds }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<HappeningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  // Responsive: slides are as wide as the card actually is — measured via
  // onLayout (module-scope Dimensions broke on phone viewports/resizes).
  const [slideWidth, setSlideWidth] = useState(0);
  const listRef = useRef<FlatList<HappeningItem>>(null);
  const indexRef = useRef(0);

  const load = useCallback(async () => {
    if (communityIds.length === 0) { setLoading(false); return; }
    const now = new Date().toISOString();
    const tonightEnd = addHours(new Date(), 24).toISOString();
    try {
      const [roomsRes, eventsRes, gamesRes] = await Promise.all([
        supabase.from('community_rooms').select('id, name, participant_count, communities(name)')
          .in('community_id', communityIds).eq('status', 'live').eq('is_active', true).limit(5),
        supabase.from('events').select('id, title, starts_at, communities(name)')
          .in('community_id', communityIds).gte('starts_at', now).lte('starts_at', tonightEnd)
          .eq('is_private', false).order('starts_at', { ascending: true }).limit(5),
        supabase.from('community_games').select('id, communities(name), games!inner(id, name, status)')
          .in('community_id', communityIds).eq('games.status', 'live').limit(3),
      ]);

      const rooms: HappeningItem[] = (roomsRes.data ?? []).map((r: any) => ({
        kind: 'room', id: r.id, name: r.name,
        communityName: r.communities?.name ?? '',
        participantCount: r.participant_count ?? null,
      }));
      const events: HappeningItem[] = (eventsRes.data ?? []).map((e: any) => ({
        kind: 'event', id: e.id, title: e.title,
        communityName: e.communities?.name ?? '', startsAt: e.starts_at,
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

  // Auto-advance: loop through slides; any manual swipe resets the rhythm
  // because momentum end updates indexRef.
  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => {
      const next = (indexRef.current + 1) % items.length;
      indexRef.current = next;
      setCurrentIndex(next);
      listRef.current?.scrollToIndex({ index: next, animated: true });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [items.length]);

  if (loading) {
    return (
      <LinearGradient colors={['#FF6A2E', '#FF2F71', '#E81C8E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.outer}>
        <ActivityIndicator color="#fff" style={{ padding: 48 }} />
      </LinearGradient>
    );
  }
  if (items.length === 0) return null;

  const iconFor = (item: HappeningItem) =>
    item.kind === 'room' ? 'videocam' : item.kind === 'game' ? 'game-controller' : 'flash';

  const openItem = (item: HappeningItem) => {
    if (item.kind === 'room') {
      router.push(`/(tabs)/connect/community-room-session?room_id=${item.id}` as any);
    } else if (item.kind === 'event') {
      router.push(`/event/${item.id}` as any);
    } else {
      router.push('/(tabs)/discover' as any);
    }
  };

  const renderSlide = ({ item }: { item: HappeningItem }) => (
    <View style={[s.slide, { width: slideWidth }]}>
      <View style={s.iconPlate}>
        <Ionicons name={iconFor(item)} size={20} color="#FF2F71" />
      </View>
      <View style={s.middleCol}>
        <View style={s.pillLabel}>
          <Text style={s.pillLabelText}>
            {item.kind === 'room' ? 'HAPPENING NOW' : 'HAPPENING TONIGHT'}
          </Text>
        </View>
        <Text style={s.itemTitle} numberOfLines={1}>
          {item.kind === 'room' ? item.name : item.title}
        </Text>
        <Text style={s.itemMeta} numberOfLines={1}>
          {item.kind === 'event'
            ? `${format(new Date(item.startsAt), 'h:mm a')} · ${item.communityName}`
            : item.kind === 'room' && item.participantCount
              ? `${item.communityName} · ${item.participantCount} here now`
              : item.communityName}
        </Text>
      </View>
      <View style={s.rightCol}>
        {item.kind === 'event'
          ? <Countdown startsAt={item.startsAt} />
          : (
            <View style={s.livePill}>
              <LivePulse />
              <Text style={s.livePillText}>{item.kind === 'room' ? 'LIVE' : 'OPEN NOW'}</Text>
            </View>
          )}
        <TouchableOpacity
          style={s.joinBtn}
          onPress={() => openItem(item)}
          accessibilityLabel={item.kind === 'game' ? 'Play now' : 'Join now'}
        >
          <Text style={s.joinBtnText}>{item.kind === 'game' ? 'Play now' : 'Join now'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <LinearGradient
      colors={['#FF6A2E', '#FF2F71', '#E81C8E']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.outer}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 0 && w !== slideWidth) {
          // Width changed (rotation/resize): remount resets scroll to 0,
          // so keep the index state in sync.
          indexRef.current = 0;
          setCurrentIndex(0);
          setSlideWidth(w);
        }
      }}
    >
      {slideWidth > 0 && (
      <FlatList
        // Re-mount when the measured width changes so pagination offsets stay exact.
        key={slideWidth}
        ref={listRef}
        data={items}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        renderItem={renderSlide}
        horizontal
        nestedScrollEnabled
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={slideWidth}
        decelerationRate="fast"
        disableIntervalMomentum
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / slideWidth);
          indexRef.current = idx;
          setCurrentIndex(idx);
        }}
        getItemLayout={(_, i) => ({ length: slideWidth, offset: slideWidth * i, index: i })}
      />
      )}
      {items.length > 1 && (
        <View style={s.dots}>
          {items.map((_, i) => (
            <View key={i} style={[s.dot, i === currentIndex && s.dotActive]} />
          ))}
        </View>
      )}
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  outer: {
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: '#E81C8E', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 16, elevation: 8,
  },
  slide: {
    minHeight: 104,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  iconPlate: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'flex-start',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2, shadowRadius: 8,
  },
  middleCol: { flex: 1, justifyContent: 'center' },
  rightCol: { alignItems: 'flex-end', justifyContent: 'space-between' },
  pillLabel: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2,
    marginBottom: 4,
  },
  pillLabelText: { color: '#fff', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6 },
  itemTitle: { fontSize: 16.5, fontWeight: '800', lineHeight: 20, color: '#fff' },
  itemMeta: { fontSize: 11.5, marginTop: 2, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  joinBtn: {
    backgroundColor: '#fff',
    borderRadius: 999, paddingHorizontal: 16, minHeight: 36,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18, shadowRadius: 6,
  },
  joinBtnText: { color: '#E81C8E', fontSize: 13, fontWeight: '800' },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(26,10,46,0.35)',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: 'flex-end',
  },
  livePillText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  countdownLabel: {
    fontSize: 8, fontWeight: '800', letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.8)', marginBottom: 3,
    alignSelf: 'flex-end',
  },
  countdownRow: { flexDirection: 'row', alignItems: 'flex-start' },
  countdownUnit: { flexDirection: 'row', alignItems: 'center' },
  countdownBox: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 3,
    alignItems: 'center',
  },
  countdownDigits: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  countdownUnitLabel: {
    color: 'rgba(255,255,255,0.7)', fontSize: 7, fontWeight: '700',
    marginLeft: 2, marginRight: 2,
  },
  countdownColonSpacer: { width: 1 },
  dots: { flexDirection: 'row', gap: 4, justifyContent: 'center', paddingBottom: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: '#fff' },
});
