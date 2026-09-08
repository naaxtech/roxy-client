import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { syncMyBadges } from '../lib/badges';
import { useAuthStore } from '../store/authStore';
import { useThemeColors } from '../hooks/useThemeColors';

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

export default function BadgesScreen() {
  const colors = useThemeColors();
  const { user } = useAuthStore();
  const router = useRouter();
  const [badges, setBadges] = useState<BadgeProgressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);

  const userId = user?.id;

  // Returns the rows rather than setting state, so the effect below owns every
  // write and can drop a response that landed after unmount.
  const fetchBadges = useCallback(async (): Promise<BadgeProgressRow[] | null> => {
    if (!userId) return null;
    const { data, error } = await supabase
      .from('user_badge_progress')
      .select('*, badges(*)')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false, nullsFirst: false });
    if (error) return null;
    return (data ?? []) as BadgeProgressRow[];
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    void (async () => {
      // 1. Paint what the server already knows. The sync must never be able to
      //    hold this screen on a spinner.
      const rows = await fetchBadges();
      if (cancelled) return;
      if (rows === null) setFetchError('Failed to load badges');
      else setBadges(rows);
      setLoading(false);

      // 2. Only `community_joins` is trigger-awarded (migration 087 §6);
      //    connections, messages and speed_dates are earned here or nowhere.
      //    Forced: opening this screen is an explicit "show me where I am", and
      //    its rate is bounded by navigation.
      const result = await syncMyBadges(userId, { force: true });
      if (cancelled) return;
      setSyncFailed(result.status === 'failed');
      if (result.status !== 'synced') return;

      // 3. Re-read so anything the sync just awarded — or any progress bar it
      //    moved — shows up in this visit, not the next one.
      const fresh = await fetchBadges();
      if (cancelled || fresh === null) return;
      setBadges(fresh);
      setFetchError(null);
    })();

    return () => { cancelled = true; };
  }, [userId, fetchBadges]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { width: 60, flexDirection: 'row', alignItems: 'center' },
    backLabel: { fontSize: 15, color: colors.textPrimary, marginLeft: 2 },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    centreWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
    emptyIcon: { fontSize: 48 },
    emptyTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', textAlign: 'center' },
    emptySub: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    syncNote: {
      color: colors.textMuted,
      fontSize: 12,
      textAlign: 'center',
      paddingHorizontal: 16,
      paddingTop: 10,
    },
    listContent: { padding: 16 },
    badgeCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
    },
    badgeCardRight: { marginLeft: 8 },
    badgeCardDim: { opacity: 0.5 },
    badgeEmoji: { fontSize: 28, marginBottom: 6 },
    badgeName: { color: colors.textPrimary, fontWeight: '700', fontSize: 13, marginBottom: 2 },
    badgeDesc: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
    badgeEarned: { color: colors.roxy, fontSize: 11, fontWeight: '600', marginTop: 4 },
    progressBarBg: {
      height: 4,
      backgroundColor: 'rgba(255,255,255,0.15)',
      borderRadius: 2,
      marginTop: 6,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: 4,
      backgroundColor: colors.roxy,
      borderRadius: 2,
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Badges 🏆</Text>
        <View style={styles.backBtn} />
      </View>

      {/* A failed sync never hides the badges she already has — it says so and
          gets out of the way. The detail is in Crashlytics, not on her screen. */}
      {syncFailed && !loading && (
        <Text style={styles.syncNote} testID="badge-sync-note">
          Roxy could not check for new badges just now — anything you have earned is safe.
        </Text>
      )}

      {loading ? (
        <View style={styles.centreWrap}>
          <ActivityIndicator size="large" color={colors.roxy} accessibilityLabel="Loading badges" />
        </View>
      ) : fetchError ? (
        <View style={styles.centreWrap}>
          <Text style={styles.emptySub}>{fetchError}</Text>
        </View>
      ) : badges.length === 0 ? (
        <View style={styles.centreWrap} testID="badges-empty">
          <Text style={styles.emptyIcon}>🏅</Text>
          <Text style={styles.emptyTitle}>Your first badge is waiting</Text>
          <Text style={styles.emptySub}>
            Roxy is keeping score. Join a community, send a first message, make a friend or try a
            speed date — your badge lands here the moment you do.
          </Text>
        </View>
      ) : (
        <FlashList
          data={badges.filter((b) => b.badges !== null)}
          numColumns={2}
          estimatedItemSize={100}
          keyExtractor={(item) => item.badge_id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => {
            const badge = item.badges!;
            const earned = item.earned_at !== null;
            return (
              <View style={[
                styles.badgeCard,
                index % 2 === 1 && styles.badgeCardRight,
                !earned && styles.badgeCardDim,
              ]}>
                <Text style={styles.badgeEmoji}>{badge.emoji}</Text>
                <Text style={styles.badgeName} numberOfLines={1}>{badge.name}</Text>
                <Text style={styles.badgeDesc} numberOfLines={2}>{badge.description}</Text>
                {earned ? (
                  <Text style={styles.badgeEarned}>✓ Earned</Text>
                ) : null}
                {!earned && item.current_value > 0 && (
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${Math.min((item.current_value / badge.requirement_threshold) * 100, 100)}%` }]} />
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
