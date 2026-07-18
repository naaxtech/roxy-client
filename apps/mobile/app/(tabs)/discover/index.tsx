import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useCommunityStore } from '../../../store/communityStore';
import { useThemeColors } from '../../../hooks/useThemeColors';

const CATEGORY_EMOJI: Record<string, string> = {
  dating: '⚡', icebreaker: '💞', party: '🃏', trivia: '🎯', other: '🎮',
};

const GRAD_COLORS = ['#FF6A2E', '#FF2F71', '#E81C8E'] as const;
const TILE_GRADS = [
  ['#FF6A2E', '#E81C8E'],
  ['#8B5CF6', '#E879A6'],
  ['#FF2F71', '#8B5CF6'],
  ['#F472B6', '#FF6A2E'],
] as const;

type Game = {
  id: string; name: string; short_description: string;
  category: string; publisher_type: 'roxy' | 'community';
  url: string | null; thumbnail_url: string | null;
};
type CommunityGame = Game & { community_name?: string };
type LiveRoom = {
  id: string; name: string; participant_count: number;
  community_name: string; status: string;
};

function GameTile({
  emoji, name, sub, grad, badge, onPress,
}: {
  emoji: string; name: string; sub: string;
  grad: readonly [string, string]; badge?: string; onPress?: () => void;
}) {
  const colors = useThemeColors();
  const s = StyleSheet.create({
    tile: {
      flex: 1, margin: 5, borderRadius: 18,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
    },
    gradTop: { height: 72, alignItems: 'center', justifyContent: 'center' },
    emoji: { fontSize: 28 },
    body: { padding: 10, gap: 3 },
    badge: {
      position: 'absolute', top: 8, right: 8,
      backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 8,
      paddingHorizontal: 6, paddingVertical: 2,
    },
    badgeText: { fontSize: 10, fontWeight: '700', color: '#1A0A2E' },
    name: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
    sub: { color: colors.textMuted, fontSize: 11 },
  });
  return (
    <TouchableOpacity style={s.tile} onPress={onPress} activeOpacity={0.82}>
      <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.gradTop}>
        <Text style={s.emoji}>{emoji}</Text>
        {badge && (
          <View style={s.badge}><Text style={s.badgeText}>{badge}</Text></View>
        )}
      </LinearGradient>
      <View style={s.body}>
        <Text style={s.name} numberOfLines={1}>{name}</Text>
        <Text style={s.sub} numberOfLines={1}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function PlayScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const { joinedIds, joinedCommunities, hydrate } = useCommunityStore();

  const [originals, setOriginals] = useState<Game[]>([]);
  const [communityGames, setCommunityGames] = useState<CommunityGame[]>([]);
  const [liveRooms, setLiveRooms] = useState<LiveRoom[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { void hydrate(user?.id); }, [user?.id]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [origRes, liveRes] = await Promise.all([
      supabase.from('games').select('*').eq('publisher_type', 'roxy').order('name'),
      supabase
        .from('community_rooms')
        .select('id, name, participant_count, status, communities(name)')
        .eq('is_active', true)
        .neq('status', 'closed')
        .order('participant_count', { ascending: false })
        .limit(3),
    ]);
    if (origRes.data) setOriginals(origRes.data as Game[]);
    if (liveRes.data) {
      setLiveRooms(liveRes.data.map((r: any) => ({
        id: r.id, name: r.name,
        participant_count: r.participant_count ?? 0,
        community_name: (r.communities as any)?.name ?? 'Roxy',
        status: r.status,
      })));
    }

    // Community games for joined communities
    if (joinedIds.size > 0) {
      const ids = Array.from(joinedIds);
      const { data } = await supabase
        .from('community_games')
        .select('community_id, games(*), communities(name)')
        .in('community_id', ids)
        .limit(4);
      if (data) {
        const games = data
          .map((row: any) => ({
            ...(row.games as Game),
            community_name: (row.communities as any)?.name,
          }))
          .filter((g: any) => g?.id) as CommunityGame[];
        setCommunityGames(games);
      }
    }
    setLoading(false);
  }, [joinedIds]);

  useEffect(() => { void loadData(); }, [loadData]);

  const navigateToGame = (game: Game | CommunityGame) => {
    if (game.name === 'Speed Dating' || game.url === null) {
      router.push('/speed-dating' as any);
    } else if (game.url) {
      router.push(game.url as any);
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 18, paddingTop: 6, paddingBottom: 12,
    },
    headerLeft: { flex: 1 },
    eyebrow: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
    title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
    iconBtn: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center',
    },

    // Speed Dating Hero
    hero: { marginHorizontal: 14, borderRadius: 22, overflow: 'hidden', marginBottom: 8 },
    heroInner: { padding: 20 },
    heroTags: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    heroTag: {
      backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 20,
      paddingHorizontal: 10, paddingVertical: 4,
    },
    heroTagText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    heroEmoji: { fontSize: 44, marginBottom: 8 },
    heroTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 6 },
    heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 20, marginBottom: 16 },
    heroFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heroLive: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    heroPulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
    heroLiveText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    heroPlayBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: '#fff', borderRadius: 999,
      paddingHorizontal: 18, paddingVertical: 10,
    },
    heroPlayText: { color: '#E81C8E', fontWeight: '800', fontSize: 14 },

    // Sections
    section: { marginBottom: 20 },
    secBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, marginBottom: 10 },
    secName: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    secNameText: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    secLink: { color: colors.roxy, fontSize: 13, fontWeight: '600' },
    gameGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 9 },

    // Live rooms
    liveCard: {
      backgroundColor: colors.surface, marginHorizontal: 14,
      borderRadius: 14, overflow: 'hidden',
    },
    liveRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 14, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.background,
    },
    liveEmoji: {
      width: 38, height: 38, borderRadius: 12,
      backgroundColor: colors.primary + '18',
      alignItems: 'center', justifyContent: 'center',
    },
    liveEmojiText: { fontSize: 18 },
    liveBody: { flex: 1 },
    liveName: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
    liveMeta: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
    seatsChip: {
      backgroundColor: colors.primary + '18', borderRadius: 10,
      paddingHorizontal: 8, paddingVertical: 3,
    },
    seatsText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
    pulseRed: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },

    emptyBox: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 32 },
    emptyText: { color: colors.textMuted, textAlign: 'center', fontSize: 13, lineHeight: 18 },
  });

  // Fallback Roxy Originals in case DB is empty
  const displayOriginals: Game[] = originals.length > 0 ? originals : [
    { id: 'sd', name: 'Speed Dating', short_description: '1-on-1, 5 min each', category: 'dating', publisher_type: 'roxy', url: null, thumbnail_url: null },
    { id: 'tt', name: 'Two Truths & a Lie', short_description: 'Break the ice', category: 'icebreaker', publisher_type: 'roxy', url: null, thumbnail_url: null },
    { id: 'wyr', name: 'Would You Rather', short_description: 'Spicy or sweet', category: 'party', publisher_type: 'roxy', url: null, thumbnail_url: null },
    { id: 'tot', name: 'This or That', short_description: 'Rapid-fire taste check', category: 'trivia', publisher_type: 'roxy', url: null, thumbnail_url: null },
  ];

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.eyebrow}>Games & Rooms</Text>
          <Text style={s.title}>Play</Text>
        </View>
        <TouchableOpacity
          style={s.iconBtn}
          onPress={() => router.push('/communities' as any)}
          accessibilityLabel="Browse communities"
        >
          <Ionicons name="people-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Speed Dating Hero */}
        <View style={s.hero}>
          <LinearGradient
            colors={GRAD_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.heroInner}
          >
            <View style={s.heroTags}>
              <View style={s.heroTag}><Text style={s.heroTagText}>⚡ Featured</Text></View>
              <View style={s.heroTag}><Text style={s.heroTagText}>Roxy Original</Text></View>
            </View>
            <Text style={s.heroEmoji}>⚡</Text>
            <Text style={s.heroTitle}>Speed Dating</Text>
            <Text style={s.heroSub}>Five minutes, real connections. Get matched with sapphics near you.</Text>
            <View style={s.heroFoot}>
              <View style={s.heroLive}>
                <View style={s.heroPulse} />
                <Text style={s.heroLiveText}>Live now</Text>
              </View>
              <TouchableOpacity
                style={s.heroPlayBtn}
                onPress={() => router.push('/speed-dating' as any)}
                activeOpacity={0.85}
              >
                <Ionicons name="play" size={15} color="#E81C8E" />
                <Text style={s.heroPlayText}>Play</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

        {/* Live Rooms */}
        {loading ? (
          <ActivityIndicator color={colors.roxy} style={{ marginTop: 16, marginBottom: 24 }} />
        ) : liveRooms.length > 0 && (
          <View style={s.section}>
            <View style={s.secBar}>
              <View style={s.secName}>
                <View style={s.pulseRed} />
                <Text style={s.secNameText}>Live now</Text>
              </View>
              <TouchableOpacity onPress={() => router.push('/(tabs)/connect' as any)}>
                <Text style={s.secLink}>All →</Text>
              </TouchableOpacity>
            </View>
            <View style={s.liveCard}>
              {liveRooms.map((room, i) => (
                <TouchableOpacity
                  key={room.id}
                  style={[s.liveRow, i === liveRooms.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => router.push(`/(tabs)/connect` as any)}
                  activeOpacity={0.8}
                >
                  <View style={s.liveEmoji}>
                    <Text style={s.liveEmojiText}>🎙️</Text>
                  </View>
                  <View style={s.liveBody}>
                    <Text style={s.liveName} numberOfLines={1}>{room.name}</Text>
                    <Text style={s.liveMeta}>{room.community_name} · in progress</Text>
                  </View>
                  {room.participant_count > 0 && (
                    <View style={s.seatsChip}>
                      <Text style={s.seatsText}>{room.participant_count} in</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Roxy Originals */}
        <View style={s.section}>
          <View style={s.secBar}>
            <View style={s.secName}>
              <Ionicons name="sparkles" size={15} color={colors.roxy} />
              <Text style={s.secNameText}>Roxy Originals</Text>
            </View>
          </View>
          <View style={s.gameGrid}>
            {displayOriginals.slice(0, 4).map((g, i) => (
              <View key={g.id} style={{ width: '50%' }}>
                <GameTile
                  emoji={CATEGORY_EMOJI[g.category] ?? '🎮'}
                  name={g.name}
                  sub={g.short_description}
                  grad={TILE_GRADS[i % TILE_GRADS.length]}
                  onPress={() => navigateToGame(g)}
                />
              </View>
            ))}
          </View>
        </View>

        {/* From Your Communities */}
        <View style={s.section}>
          <View style={s.secBar}>
            <View style={s.secName}>
              <Ionicons name="people" size={15} color={colors.secondary} />
              <Text style={s.secNameText}>From your communities</Text>
            </View>
            {joinedCommunities.length > 0 && (
              <TouchableOpacity onPress={() => router.push('/communities' as any)}>
                <Text style={s.secLink}>Browse →</Text>
              </TouchableOpacity>
            )}
          </View>
          {joinedIds.size === 0 ? (
            <View style={s.emptyBox}>
              <Text style={s.emptyText}>
                Join a community to see their games here.{'\n'}
                <Text
                  style={{ color: colors.roxy, fontWeight: '700' }}
                  onPress={() => router.push('/communities' as any)}
                >
                  Browse communities →
                </Text>
              </Text>
            </View>
          ) : communityGames.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={s.emptyText}>Your communities haven't added games yet.</Text>
            </View>
          ) : (
            <View style={s.gameGrid}>
              {communityGames.slice(0, 4).map((g, i) => (
                <View key={g.id + i} style={{ width: '50%' }}>
                  <GameTile
                    emoji={CATEGORY_EMOJI[g.category] ?? '🎮'}
                    name={g.name}
                    sub={g.community_name ?? g.short_description}
                    grad={TILE_GRADS[i % TILE_GRADS.length]}
                    badge={g.community_name?.split(' ')[0]}
                    onPress={() => navigateToGame(g)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
