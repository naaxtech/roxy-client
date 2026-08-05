import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Modal, Pressable, Animated,
} from 'react-native';
import { usePopIn } from '../../../components/ui/popIn';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { supabase } from '../../../lib/supabase';
import { avatarGradient } from '../../../lib/avatars';
import { useAuthStore } from '../../../store/authStore';
import { useCommunityStore } from '../../../store/communityStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { SectionHeader } from '../../../components/ui/SectionHeader';
import { EmptyState } from '../../../components/ui/EmptyState';
import { isPlayableGameUrl } from '../../../lib/gameUrl';
import { logError } from '../../../lib/errorLogger';

const CATEGORY_EMOJI: Record<string, string> = {
  dating: '⚡', icebreaker: '💞', party: '🃏', trivia: '🎯', other: '🎮',
};

/** The one Roxy original that runs as a native flow rather than a hosted URL. */
const SPEED_DATING = 'Speed Dating';

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
type CommunityGame = Game & {
  community_name?: string;
  /** Every community offering this game — one tile per game, tagged. */
  offeredBy: { id: string; name: string }[];
};
type LiveRoom = {
  id: string; name: string; participant_count: number;
  community_name: string; status: string;
  room_type: 'video' | 'audio'; banner_url: string | null;
};

const isSpeedDating = (g: Game): boolean => g.name === SPEED_DATING;
/** Openable right now: the native Speed Dating flow, or an https game the WebView host can load. */
const isPlayable = (g: Game): boolean => isSpeedDating(g) || isPlayableGameUrl(g.url);

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
  const [gamesError, setGamesError] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => { void hydrate(user?.id); }, [user?.id]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setGamesError(false);
    const [origRes, liveRes] = await Promise.all([
      supabase.from('games').select('*').eq('publisher_type', 'roxy').order('name'),
      supabase
        .from('community_rooms')
        .select('id, name, participant_count, status, room_type, banner_url, communities(name)')
        .eq('is_active', true)
        .neq('status', 'closed')
        .order('participant_count', { ascending: false })
        .limit(6),
    ]);
    if (origRes.error) {
      logError(origRes.error, 'playScreen_loadGames');
      setGamesError(true);
    } else {
      setOriginals((origRes.data ?? []) as Game[]);
    }
    if (liveRes.data) {
      setLiveRooms(liveRes.data.map((r: any) => ({
        id: r.id, name: r.name,
        participant_count: r.participant_count ?? 0,
        community_name: (r.communities as any)?.name ?? 'Roxy',
        status: r.status,
        room_type: r.room_type ?? 'audio',
        banner_url: r.banner_url ?? null,
      })));
    }

    // Community games — dedupe to one tile per game, tagging every
    // community that offers it (no more Speed Dating × 4).
    if (joinedIds.size > 0) {
      const ids = Array.from(joinedIds);
      const { data } = await supabase
        .from('community_games')
        .select('community_id, games(*), communities(name)')
        .in('community_id', ids);
      if (data) {
        const byGame = new Map<string, CommunityGame>();
        for (const row of data as any[]) {
          const g = row.games as Game;
          if (!g?.id) continue;
          const offer = { id: row.community_id as string, name: (row.communities as any)?.name ?? 'Community' };
          const existing = byGame.get(g.id);
          if (existing) {
            existing.offeredBy.push(offer);
          } else {
            byGame.set(g.id, { ...g, community_name: offer.name, offeredBy: [offer] });
          }
        }
        setCommunityGames([...byGame.values()]);
      }
    }
    setLoading(false);
  }, [joinedIds]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Speed Dating gets a choice: random ("feeling wild") or via one of your
  // communities. Other games route straight in.
  const [speedDatingOptions, setSpeedDatingOptions] = useState<{ id: string; name: string }[] | null>(null);
  const sdPop = usePopIn(speedDatingOptions !== null);

  /**
   * `games.url` is an absolute https address, not an app route — pushing it into
   * expo-router made the router treat it as an in-app path and dead-end. External
   * games are hosted in the WebView launch route, which injects the Roxy SDK.
   */
  const navigateToGame = (game: Game | CommunityGame) => {
    if (isSpeedDating(game)) {
      const offeredBy = 'offeredBy' in game && game.offeredBy.length > 0
        ? game.offeredBy
        : communityGames.find(isSpeedDating)?.offeredBy ?? [];
      setSpeedDatingOptions(offeredBy);
      return;
    }
    router.push(`/(tabs)/discover/games/${game.id}` as never);
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surface, borderRadius: 14,
      marginHorizontal: 16, marginBottom: 10,
      paddingHorizontal: 12, paddingVertical: 8,
    },
    searchInput: { color: colors.textPrimary, fontSize: 14, flex: 1, paddingVertical: 0 },
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
    gameGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 9 },

    // Live rooms — banner rail
    liveRail: { paddingHorizontal: 14, gap: 10 },
    liveTile: {
      width: 190, height: 116, borderRadius: 18,
      overflow: 'hidden', justifyContent: 'space-between',
      shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.12, shadowRadius: 10, elevation: 4,
    },
    liveTileBg: { ...StyleSheet.absoluteFillObject },
    liveTileVeil: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,10,46,0.32)' },
    liveTileTop: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      padding: 8,
    },
    livePill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: '#E5484D', borderRadius: 999,
      paddingHorizontal: 8, paddingVertical: 3,
    },
    livePulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
    livePillText: { color: '#fff', fontSize: 10, fontWeight: '800' },
    liveTypeBadge: {
      width: 24, height: 24, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(26,10,46,0.45)',
    },
    liveTileBottom: { padding: 10 },
    liveTileName: { color: '#fff', fontWeight: '800', fontSize: 13, lineHeight: 17 },
    liveTileMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 2 },

    // Pop modal (Speed Dating options)
    popOverlay: {
      flex: 1, backgroundColor: 'rgba(26,10,46,0.55)',
      alignItems: 'center', justifyContent: 'center', padding: 28,
    },
    popCard: {
      width: '100%', maxWidth: 340,
      backgroundColor: colors.background, borderRadius: 22,
      padding: 20, alignItems: 'center', gap: 8,
      shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3, shadowRadius: 24, elevation: 20,
    },
    popPlate: {
      width: 56, height: 56, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center', marginBottom: 4,
    },
    popTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 19 },
    popSub: { color: colors.textMuted, fontSize: 13, marginBottom: 6 },
    popPrimary: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      alignSelf: 'stretch', minHeight: 48, borderRadius: 16,
      backgroundColor: colors.roxy,
    },
    popPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    popOption: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      alignSelf: 'stretch', minHeight: 44, borderRadius: 14,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
    },
    popOptionText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14, flex: 1 },
    popCancel: { color: colors.textMuted, fontWeight: '700', fontSize: 13, paddingVertical: 10 },
  });

  const q = query.trim().toLowerCase();
  const matchesGame = (g: Game | CommunityGame) => !q
    || g.name.toLowerCase().includes(q)
    || (g.short_description ?? '').toLowerCase().includes(q)
    || ('community_name' in g && (g.community_name ?? '').toLowerCase().includes(q));
  // Speed Dating already owns the featured hero above — listing it again here
  // is the "same game over and over" problem. Show only the other originals.
  // Everything on the grid is playable: a tile that cannot open anything is a lie,
  // which is exactly what the four hardcoded placeholder games used to be — none of
  // them existed in `games`, and every one of them opened Speed Dating.
  const shownOriginals = originals.filter((g) => !isSpeedDating(g)).filter(isPlayable).filter(matchesGame);
  const shownCommunityGames = communityGames.filter(isPlayable).filter(matchesGame);

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <ScreenHeader
        title="Play"
        eyebrow="Games & Rooms"
        actions={
          <TouchableOpacity
            style={s.iconBtn}
            onPress={() => router.push('/communities' as any)}
            accessibilityLabel="Browse communities"
          >
            <Ionicons name="people-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        }
      />

      {/* Quick search across all games */}
      <View style={s.searchRow}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} />
        <TextInput
          style={s.searchInput}
          placeholder="Search games…"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Search games"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
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
              <View style={s.heroTag}><Text style={s.heroTagText}>ROXY ORIGINAL</Text></View>
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
                onPress={() => setSpeedDatingOptions(
                  communityGames.find(isSpeedDating)?.offeredBy ?? []
                )}
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
            <SectionHeader
              title="Live now"
              icon="radio"
              linkLabel="All"
              onLinkPress={() => router.push('/(tabs)/connect' as any)}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.liveRail}>
              {liveRooms.map((room) => (
                <TouchableOpacity
                  key={room.id}
                  style={s.liveTile}
                  onPress={() => router.push(`/community-room-session?room_id=${room.id}` as any)}
                  activeOpacity={0.85}
                  accessibilityLabel={`Join ${room.name}`}
                >
                  {room.banner_url ? (
                    <ExpoImage source={{ uri: room.banner_url }} style={s.liveTileBg} contentFit="cover" />
                  ) : (
                    <LinearGradient
                      colors={avatarGradient(room.name)}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={s.liveTileBg}
                    />
                  )}
                  <View style={s.liveTileVeil} />
                  <View style={s.liveTileTop}>
                    <View style={s.livePill}>
                      <View style={s.livePulse} />
                      <Text style={s.livePillText}>LIVE</Text>
                    </View>
                    <View style={s.liveTypeBadge}>
                      <Ionicons name={room.room_type === 'video' ? 'videocam' : 'mic'} size={13} color="#fff" />
                    </View>
                  </View>
                  <View style={s.liveTileBottom}>
                    <Text style={s.liveTileName} numberOfLines={2}>{room.name}</Text>
                    <Text style={s.liveTileMeta} numberOfLines={1}>
                      {room.community_name}{room.participant_count > 0 ? ` · ${room.participant_count} in` : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Roxy Originals — real rows only. An empty grid says so rather than
            filling itself with placeholder tiles that open the wrong game. */}
        {!loading && (
          <View style={s.section}>
            <SectionHeader title="Roxy Originals" icon="sparkles" />
            {gamesError ? (
              <EmptyState
                emoji="🎮"
                title="Couldn't load games"
                body="Check your connection and try again."
                ctaLabel="Retry"
                onCtaPress={() => void loadData()}
              />
            ) : shownOriginals.length === 0 ? (
              <EmptyState
                emoji="✨"
                title={q ? 'No originals match your search' : 'Speed Dating is the only original — for now'}
                body={q ? 'Try a different search.' : 'More Roxy games are on the way. Play Speed Dating above in the meantime.'}
              />
            ) : (
              <View style={s.gameGrid}>
                {shownOriginals.slice(0, 4).map((g, i) => (
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
            )}
          </View>
        )}

        {/* From Your Communities */}
        <View style={s.section}>
          <SectionHeader
            title="From your communities"
            icon="people"
            linkLabel={joinedCommunities.length > 0 ? 'Browse' : undefined}
            onLinkPress={joinedCommunities.length > 0 ? () => router.push('/communities' as any) : undefined}
          />
          {joinedIds.size === 0 ? (
            <EmptyState
              emoji="🎮"
              title="Join a community to see their games"
              ctaLabel="Browse communities →"
              onCtaPress={() => router.push('/communities' as any)}
            />
          ) : shownCommunityGames.length === 0 ? (
            <EmptyState
              emoji="🎮"
              title={q ? 'No games match your search' : 'No community games yet'}
              body={q ? 'Try a different search.' : "Your communities haven't added games yet."}
            />
          ) : (
            <View style={s.gameGrid}>
              {shownCommunityGames.slice(0, 6).map((g, i) => (
                <View key={g.id} style={{ width: '50%' }}>
                  <GameTile
                    emoji={CATEGORY_EMOJI[g.category] ?? '🎮'}
                    name={g.name}
                    sub={g.offeredBy.length > 1
                      ? `${g.offeredBy.length} of your communities`
                      : g.community_name ?? g.short_description}
                    grad={TILE_GRADS[i % TILE_GRADS.length]}
                    badge={g.offeredBy.length > 1
                      ? `${g.offeredBy[0].name.split(' ')[0]} +${g.offeredBy.length - 1}`
                      : g.community_name?.split(' ')[0]}
                    onPress={() => navigateToGame(g)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Speed Dating join options — pop style, not a bottom drawer */}
      <Modal
        visible={speedDatingOptions !== null}
        transparent
        animationType="none"
        onRequestClose={() => setSpeedDatingOptions(null)}
      >
        <Pressable style={s.popOverlay} onPress={() => setSpeedDatingOptions(null)}>
          <Animated.View style={sdPop}>
          <Pressable style={s.popCard} onPress={() => {}}>
            <LinearGradient colors={['#FF6A2E', '#E81C8E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.popPlate}>
              <Ionicons name="flash" size={24} color="#fff" />
            </LinearGradient>
            <Text style={s.popTitle}>Speed Dating</Text>
            <Text style={s.popSub}>How do you want to play?</Text>
            <TouchableOpacity
              style={s.popPrimary}
              onPress={() => { setSpeedDatingOptions(null); router.push('/speed-dating' as any); }}
              accessibilityLabel="Join random speed dating"
            >
              <Ionicons name="flash" size={16} color="#fff" />
              <Text style={s.popPrimaryText}>Feeling wild — join random</Text>
            </TouchableOpacity>
            {(speedDatingOptions ?? []).map((c) => (
              <TouchableOpacity
                key={c.id}
                style={s.popOption}
                onPress={() => {
                  setSpeedDatingOptions(null);
                  router.push(`/speed-dating?communityId=${c.id}` as any);
                }}
                accessibilityLabel={`Speed dating with ${c.name}`}
              >
                <Ionicons name="people" size={15} color={colors.roxy} />
                <Text style={s.popOptionText} numberOfLines={1}>With {c.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setSpeedDatingOptions(null)} accessibilityLabel="Cancel">
              <Text style={s.popCancel}>Not tonight</Text>
            </TouchableOpacity>
          </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
