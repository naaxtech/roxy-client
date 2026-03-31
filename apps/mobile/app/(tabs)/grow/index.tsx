import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { callEdgeFunction, supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfile } from '../../../hooks/useProfile';
import { COLORS } from '../../../lib/constants';

type CommunityRow = { community_id: string; communities: { id: string; name: string; category: string } | null };
type FriendshipRow = { id: string; requester_id: string; addressee_id: string; status: string; created_at: string };
type BadgeProgressRow = {
  user_id: string;
  badge_id: string;
  current_value: number;
  earned_at: string | null;
  badges: {
    id: string;
    name: string;
    description: string;
    emoji: string;
    category: string;
    points_value: number;
    requirement_type: string;
    requirement_threshold: number;
  } | null;
};

function getLevelInfo(points: number): { label: string; emoji: string; nextThreshold: number | null; progress: number } {
  if (points >= 500) return { label: 'Radiant', emoji: '✨', nextThreshold: null, progress: 1 };
  if (points >= 100) return { label: 'Bloom', emoji: '🌸', nextThreshold: 500, progress: (points - 100) / 400 };
  return { label: 'Seedling', emoji: '🌱', nextThreshold: 100, progress: points / 100 };
}

export default function GrowScreen() {
  const { user } = useAuthStore();
  const { profile } = useProfile();
  const router = useRouter();

  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(true);
  const [communities, setCommunities] = useState<CommunityRow[]>([]);
  const [friendships, setFriendships] = useState<FriendshipRow[]>([]);
  const [badges, setBadges] = useState<BadgeProgressRow[]>([]);

  useEffect(() => {
    if (!profile) return;
    setGreetingLoading(true);
    callEdgeFunction<{ greeting: string }>('roxy-greeting', {})
      .then(({ data }) => setGreeting(data?.greeting ?? null))
      .finally(() => setGreetingLoading(false));
  }, [profile]);

  const loadSocial = useCallback(async () => {
    if (!user) return;
    const [commRes, friendRes] = await Promise.all([
      supabase
        .from('community_members')
        .select('community_id, communities(id, name, category)')
        .eq('user_id', user.id),
      supabase
        .from('friendships')
        .select('*')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq('status', 'accepted'),
    ]);
    if (commRes.data) setCommunities(commRes.data as CommunityRow[]);
    if (friendRes.data) setFriendships(friendRes.data as FriendshipRow[]);
  }, [user]);

  useEffect(() => { loadSocial(); }, [loadSocial]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_badge_progress')
      .select('*, badges(*)')
      .eq('user_id', user.id)
      .order('earned_at', { ascending: false, nullsFirst: false })
      .then(({ data }) => { if (data) setBadges(data as BadgeProgressRow[]); });
  }, [user?.id]);

  const points = profile?.gamification_points ?? 0;
  const level = getLevelInfo(points);
  const earnedCount = badges.filter((b) => b.earned_at !== null).length;
  const inProgressCount = badges.filter((b) => b.earned_at === null && b.current_value > 0).length;
  const avatarInitial = profile?.display_name?.[0]?.toUpperCase() ?? '?';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Mini header */}
        <View style={styles.miniHeader}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{avatarInitial}</Text>
          </View>
          <Text style={styles.screenTitle}>Grow</Text>
          <View style={styles.avatarCircle} />
        </View>

        {/* Zone 1 — Roxy Greeting Card */}
        <View style={styles.greetingCard}>
          <View style={styles.roxyDot} />
          {greetingLoading ? (
            <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 24 }} />
          ) : (
            <Text style={styles.greetingText}>{greeting ?? 'Hey — Roxy here. 👋'}</Text>
          )}
          <Text style={styles.greetingLabel}>✨ Your daily message from Roxy</Text>
        </View>

        {/* Zone 2 — My Communities */}
        <TouchableOpacity
          style={styles.section}
          onPress={() => router.push('/(tabs)/discover' as any)}
          activeOpacity={0.75}
        >
          <Text style={styles.sectionTitle}>
            My Communities{' '}
            <Text style={styles.sectionHint}>tap to browse →</Text>
          </Text>
          {communities.length === 0 ? (
            <Text style={styles.emptyState}>Join your first community in Discover →</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {communities.map((row) => (
                <View key={row.community_id} style={styles.chip}>
                  <Text style={styles.chipText}>{row.communities?.name ?? '—'}</Text>
                </View>
              ))}
              <View style={[styles.chip, styles.chipJoin]}>
                <Text style={styles.chipJoinText}>+ Join more</Text>
              </View>
            </ScrollView>
          )}
        </TouchableOpacity>

        {/* Zone 3 — My People */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My People</Text>
          {friendships.length === 0 ? (
            <Text style={styles.emptyState}>Connect with someone in Discover →</Text>
          ) : (
            <View style={styles.avatarRow}>
              {friendships.slice(0, 8).map((f) => (
                <View key={f.id} style={styles.avatar}>
                  <Text style={styles.avatarText}>{'👤'}</Text>
                </View>
              ))}
              {friendships.length > 8 && (
                <View style={styles.avatar}>
                  <Text style={styles.avatarCount}>+{friendships.length - 8}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Zone 4 — My Journey */}
        <TouchableOpacity style={styles.section} activeOpacity={0.75}>
          <Text style={styles.sectionTitle}>My Journey</Text>
          <View style={styles.levelRow}>
            <Text style={styles.levelEmoji}>{level.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.levelLabel}>{level.label}</Text>
              <Text style={styles.levelPoints}>{points} points</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${level.progress * 100}%` as any }]} />
          </View>
          {level.nextThreshold !== null ? (
            <Text style={styles.progressHint}>{level.nextThreshold - points} points to next level</Text>
          ) : (
            <Text style={styles.progressHint}>You've reached the highest level! ✨</Text>
          )}
        </TouchableOpacity>

        {/* Zone 5 — Badges preview */}
        <TouchableOpacity
          style={styles.section}
          onPress={() => router.push('/(tabs)/grow/badges' as any)}
          activeOpacity={0.75}
        >
          <Text style={styles.sectionTitle}>
            🏆 Badges{' '}
            <Text style={styles.sectionHint}>tap to see all →</Text>
          </Text>
          {badges.length === 0 ? (
            <Text style={styles.emptyState}>Complete actions to earn badges! ✨</Text>
          ) : (
            <>
              <View style={styles.badgePreviewRow}>
                {badges.slice(0, 4).map((b) => (
                  <Text
                    key={b.badge_id}
                    style={[styles.badgePreviewEmoji, b.earned_at === null && styles.badgePreviewDim]}
                  >
                    {b.badges?.emoji ?? '🏅'}
                  </Text>
                ))}
              </View>
              <Text style={styles.badgePreviewSummary}>
                {earnedCount} earned · {inProgressCount} in progress
              </Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 16, gap: 16 },

  miniHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  avatarCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary + '30',
    borderWidth: 2, borderColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  screenTitle: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800' },

  greetingCard: {
    backgroundColor: COLORS.surface, borderRadius: 24, padding: 24,
    minHeight: 180, justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  roxyDot: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.roxy, marginBottom: 12,
  },
  greetingText: { fontSize: 18, color: COLORS.textPrimary, lineHeight: 28, fontWeight: '500' },
  greetingLabel: { color: COLORS.textMuted, fontSize: 12, marginTop: 12 },

  section: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 10 },
  sectionHint: { color: COLORS.textMuted, fontSize: 11, fontWeight: '400' },
  emptyState: { color: COLORS.textMuted, fontSize: 14 },

  chipScroll: { marginTop: 4 },
  chip: {
    backgroundColor: COLORS.primary + '20', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
    marginRight: 8, borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  chipText: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },
  chipJoin: { backgroundColor: COLORS.roxy + '20', borderColor: COLORS.roxy + '60' },
  chipJoinText: { color: COLORS.roxy, fontWeight: '600', fontSize: 13 },

  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 20 },
  avatarCount: { color: COLORS.textMuted, fontWeight: '700', fontSize: 13 },

  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  levelEmoji: { fontSize: 32 },
  levelLabel: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
  levelPoints: { color: COLORS.textMuted, fontSize: 13 },
  progressTrack: {
    height: 8, backgroundColor: COLORS.surfaceLight,
    borderRadius: 4, overflow: 'hidden', marginBottom: 6,
  },
  progressFill: { height: 8, backgroundColor: COLORS.primary, borderRadius: 4 },
  progressHint: { color: COLORS.textMuted, fontSize: 12 },

  badgePreviewRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  badgePreviewEmoji: { fontSize: 26 },
  badgePreviewDim: { opacity: 0.3 },
  badgePreviewSummary: { color: COLORS.textMuted, fontSize: 12 },
});
