import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format } from 'date-fns';
import { COLORS } from '../../lib/constants';

interface CommunityRoomCardProps {
  id: string;
  name: string;
  description: string | null;
  room_type: 'video' | 'audio';
  status: 'live' | 'scheduled' | 'closed';
  scheduled_at: string | null;
  community_name: string | null;
  creator_display_name: string | null;
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
  hideCommunityTag = false,
  onPress,
}: CommunityRoomCardProps) {
  const isLive = status === 'live';
  const isScheduled = status === 'scheduled';

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

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
    gap: 4,
  },
  cardDimmed: {
    opacity: 0.65,
    borderColor: COLORS.textMuted + '30',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeIcon: { fontSize: 18 },
  name: {
    flex: 1,
    color: COLORS.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  liveBadge: {
    color: COLORS.success,
    fontSize: 11,
    fontWeight: '700',
  },
  scheduledBadge: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  description: {
    color: COLORS.textSecondary,
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
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
});
