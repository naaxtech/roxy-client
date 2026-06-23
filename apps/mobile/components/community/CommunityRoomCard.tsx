import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format } from 'date-fns';
import { useThemeColors } from '../../hooks/useThemeColors';

interface CommunityRoomCardProps {
  id: string;
  name: string;
  description: string | null;
  room_type: 'video' | 'audio';
  status: 'idle' | 'live' | 'scheduled' | 'closed';
  scheduled_at: string | null;
  community_name: string | null;
  creator_display_name: string | null;
  participant_count?: number;
  max_participants?: number | null;
  /** Hide community tag when already scoped to one community (e.g. community detail screen) */
  hideCommunityTag?: boolean;
  onPress: () => void;
}

export function CommunityRoomCard({
  name,
  description,
  room_type,
  status,
  scheduled_at,
  community_name,
  creator_display_name,
  participant_count = 0,
  max_participants,
  hideCommunityTag = false,
  onPress,
}: CommunityRoomCardProps) {
  const colors = useThemeColors();
  const isLive      = status === 'live';
  const isScheduled = status === 'scheduled';

  const ratioText = isLive
    ? max_participants != null
      ? `${participant_count} / ${max_participants}`
      : `${participant_count}`
    : max_participants != null
      ? `— / ${max_participants}`
      : null;

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.primary + '30',
      gap: 4,
    },
    cardDimmed: {
      opacity: 0.65,
      borderColor: colors.textMuted + '30',
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    typeIcon: { fontSize: 18 },
    name: {
      flex: 1,
      color: colors.textPrimary,
      fontWeight: '700',
      fontSize: 14,
    },
    ratio: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    liveBadge: {
      color: colors.success,
      fontSize: 11,
      fontWeight: '700',
    },
    scheduledBadge: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    description: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
    },
    metaRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 2,
      flexWrap: 'wrap',
    },
    metaTag: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
  });

  return (
    <TouchableOpacity
      testID="room-card"
      style={[styles.card, !isLive && styles.cardDimmed]}
      onPress={isLive ? onPress : undefined}
      activeOpacity={isLive ? 0.75 : 1}
    >
      <View style={styles.topRow}>
        <Text style={styles.typeIcon}>{room_type === 'video' ? '🎥' : '🎙️'}</Text>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {ratioText != null && (
          <Text style={styles.ratio}>{ratioText}</Text>
        )}
        {isLive && <Text style={styles.liveBadge}>● Live</Text>}
        {isScheduled && (
          <Text testID="scheduled-badge" style={styles.scheduledBadge}>
            🕐 {scheduled_at ? format(new Date(scheduled_at), 'dd MMM · HH:mm') : 'Scheduled'}
          </Text>
        )}
      </View>

      {description ? (
        <Text style={styles.description} numberOfLines={1}>{description}</Text>
      ) : null}

      <View style={styles.metaRow}>
        {!hideCommunityTag && community_name ? (
          <Text style={styles.metaTag}>🏘 {community_name}</Text>
        ) : null}
        {creator_display_name ? (
          <Text style={styles.metaTag}>👑 {creator_display_name}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}
