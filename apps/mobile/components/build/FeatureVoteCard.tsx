import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';

export interface FeatureRequest {
  id: string;
  title: string;
  description: string | null;
  type: 'planned' | 'pitched';
  status: 'open' | 'in_progress' | 'done' | 'rejected';
  vote_count: number;
  created_at: string;
}

const STATUS_LABEL: Record<FeatureRequest['status'], string> = {
  open: 'Open',
  in_progress: '⚡ In Progress',
  done: '✓ Done',
  rejected: 'Rejected',
};

export function FeatureVoteCard({
  feature,
  voted,
  onVote,
}: {
  feature: FeatureRequest;
  voted: boolean;
  onVote: (id: string) => Promise<void>;
}) {
  const colors = useThemeColors();
  const [loading, setLoading] = useState(false);
  const [localVoted, setLocalVoted] = useState(voted);
  const [localCount, setLocalCount] = useState(feature.vote_count);

  const STATUS_COLOR: Record<FeatureRequest['status'], string> = {
    open: colors.textMuted,
    in_progress: '#F59E0B',
    done: '#22C55E',
    rejected: '#EF4444',
  };

  const handleVote = async () => {
    if (loading) return;
    // Optimistic update
    setLocalVoted((v) => !v);
    setLocalCount((c) => localVoted ? Math.max(c - 1, 0) : c + 1);
    setLoading(true);
    try {
      await onVote(feature.id);
    } catch {
      // Revert on error
      setLocalVoted((v) => !v);
      setLocalCount((c) => localVoted ? c + 1 : Math.max(c - 1, 0));
    } finally {
      setLoading(false);
    }
  };

  const styles = StyleSheet.create({
    card: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      marginHorizontal: 16,
      marginBottom: 10,
      gap: 12,
    },
    left: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 52,
    },
    voteBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      padding: 8,
      backgroundColor: colors.background,
      minWidth: 48,
      minHeight: 52,
    },
    voteBtnActive: {
      backgroundColor: `${colors.primary}22`,
    },
    voteHeart: {
      fontSize: 18,
    },
    voteHeartActive: {},
    voteCount: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textMuted,
      marginTop: 2,
    },
    voteCountActive: {
      color: colors.primary,
    },
    right: {
      flex: 1,
      gap: 4,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      flexWrap: 'wrap',
    },
    title: {
      flex: 1,
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      lineHeight: 20,
    },
    plannedBadge: {
      backgroundColor: `${colors.primary}33`,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    plannedBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.primary,
      letterSpacing: 0.3,
    },
    desc: {
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 18,
    },
    status: {
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
    },
  });

  return (
    <View style={styles.card}>
      <View style={styles.left}>
        <TouchableOpacity
          style={[styles.voteBtn, localVoted && styles.voteBtnActive]}
          onPress={handleVote}
          disabled={loading}
          accessibilityLabel={localVoted ? 'Remove vote' : 'Vote for this feature'}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Ionicons
                name={localVoted ? 'heart' : 'heart-outline'}
                size={18}
                color={localVoted ? colors.roxy : colors.textMuted}
              />
              <Text style={[styles.voteCount, localVoted && styles.voteCountActive]}>
                {localCount}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.right}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>{feature.title}</Text>
          {feature.type === 'planned' && (
            <View style={styles.plannedBadge}>
              <Text style={styles.plannedBadgeText}>Roxy Pick</Text>
            </View>
          )}
        </View>
        {feature.description ? (
          <Text style={styles.desc} numberOfLines={2}>{feature.description}</Text>
        ) : null}
        <Text style={[styles.status, { color: STATUS_COLOR[feature.status] }]}>
          {STATUS_LABEL[feature.status]}
        </Text>
      </View>
    </View>
  );
}
