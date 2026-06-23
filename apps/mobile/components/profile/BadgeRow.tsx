import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { UserBadgeProgress, Badge } from '../../types';

export type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

const MAX_VISIBLE = 5;

interface BadgeRowProps {
  badges: EarnedBadge[];
}

export function BadgeRow({ badges }: BadgeRowProps) {
  const colors = useThemeColors();
  const [tooltipId, setTooltipId] = useState<string | null>(null);

  const styles = StyleSheet.create({
    container: { alignItems: 'center', marginTop: 6 },
    row: { flexDirection: 'row', gap: 4, alignItems: 'center' },
    badgeBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceLight,
    },
    emoji: { fontSize: 16 },
    overflow: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceLight,
    },
    overflowText: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
    tooltip: {
      marginTop: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.surfaceLight,
      maxWidth: 220,
      alignItems: 'center',
    },
    tooltipName: { color: colors.textPrimary, fontWeight: '700', fontSize: 12 },
    tooltipDesc: { color: colors.textMuted, fontSize: 11, marginTop: 2, textAlign: 'center' },
  });

  const earned = badges.filter((b) => b.earned_at !== null);
  const visible = earned.slice(0, MAX_VISIBLE);
  const overflow = earned.length - MAX_VISIBLE;
  const tooltipBadge = earned.find((b) => b.badge_id === tooltipId) ?? null;

  if (earned.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {visible.map((b) => (
          <TouchableOpacity
            key={b.badge_id}
            style={styles.badgeBtn}
            onPress={() => setTooltipId(tooltipId === b.badge_id ? null : b.badge_id)}
          >
            <Text style={styles.emoji}>{b.badges?.emoji ?? '🏅'}</Text>
          </TouchableOpacity>
        ))}
        {overflow > 0 && (
          <View style={styles.overflow}>
            <Text style={styles.overflowText}>+{overflow}</Text>
          </View>
        )}
      </View>

      {tooltipBadge && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipName}>{tooltipBadge.badges?.name}</Text>
          <Text style={styles.tooltipDesc}>{tooltipBadge.badges?.description}</Text>
        </View>
      )}
    </View>
  );
}
