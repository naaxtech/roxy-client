import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useThemeColors } from '../../../hooks/useThemeColors';

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

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_badge_progress')
      .select('*, badges(*)')
      .eq('user_id', user.id)
      .order('earned_at', { ascending: false, nullsFirst: false })
      .then(({ data, error }) => {
        if (error) {
          setFetchError('Failed to load badges');
          setLoading(false);
          return;
        }
        if (data) setBadges(data as BadgeProgressRow[]);
        setLoading(false);
      });
  }, [user?.id]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { width: 60, flexDirection: 'row', alignItems: 'center' },
    backIcon: { fontSize: 32, color: colors.textPrimary, lineHeight: 36 },
    backLabel: { fontSize: 15, color: colors.textPrimary, marginLeft: 2 },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    centreWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    emptyIcon: { fontSize: 48 },
    emptyTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
    emptySub: { color: colors.textMuted, fontSize: 14 },
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Badges 🏆</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.centreWrap}>
          <ActivityIndicator size="large" color={colors.roxy} />
        </View>
      ) : fetchError ? (
        <View style={styles.centreWrap}>
          <Text style={styles.emptySub}>{fetchError}</Text>
        </View>
      ) : badges.length === 0 ? (
        <View style={styles.centreWrap}>
          <Text style={styles.emptyIcon}>🏅</Text>
          <Text style={styles.emptyTitle}>No badges yet</Text>
          <Text style={styles.emptySub}>Complete actions to earn badges!</Text>
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

