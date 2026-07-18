import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useThemeColors } from '../../hooks/useThemeColors';
import { avatarGradient } from '../../lib/avatars';

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
  banner_url?: string | null;
  /** Hide community tag when already scoped to one community (e.g. community detail screen) */
  hideCommunityTag?: boolean;
  onPress: () => void;
}

/**
 * Banner-style room card: admin-uploaded cover (room-banners bucket) or a
 * name-hashed brand gradient fallback, dark veil, live/scheduled pills.
 */
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
  banner_url,
  hideCommunityTag = false,
  onPress,
}: CommunityRoomCardProps) {
  const colors = useThemeColors();
  const isLive = status === 'live';
  const isScheduled = status === 'scheduled';

  const countText = isLive
    ? max_participants != null
      ? `${participant_count}/${max_participants} in`
      : `${participant_count} in`
    : null;

  const styles = StyleSheet.create({
    card: {
      borderRadius: 18,
      overflow: 'hidden',
      marginBottom: 10,
      backgroundColor: colors.surface,
      shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
    },
    cardDimmed: { opacity: 0.72 },
    cover: { height: 96, justifyContent: 'space-between' },
    coverImg: { ...StyleSheet.absoluteFillObject },
    veil: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(26,10,46,0.28)',
    },
    coverTop: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      padding: 10,
    },
    pill: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
      backgroundColor: 'rgba(26,10,46,0.55)',
    },
    pillLive: { backgroundColor: '#E5484D' },
    pillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
    pulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
    typeBadge: {
      width: 30, height: 30, borderRadius: 15,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.22)',
      alignSelf: 'flex-end', margin: 10,
    },
    body: { padding: 12, gap: 3 },
    name: { color: colors.textPrimary, fontWeight: '800', fontSize: 14.5 },
    description: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' },
    metaTag: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
    metaDot: { color: colors.textMuted, fontSize: 11 },
  });

  return (
    <TouchableOpacity
      testID="room-card"
      style={[styles.card, !isLive && styles.cardDimmed]}
      onPress={isLive ? onPress : undefined}
      activeOpacity={isLive ? 0.85 : 1}
      accessibilityLabel={isLive ? `Join room ${name}` : name}
    >
      <View style={styles.cover}>
        {banner_url ? (
          <ExpoImage source={{ uri: banner_url }} style={styles.coverImg} contentFit="cover" />
        ) : (
          <LinearGradient
            colors={avatarGradient(name)}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.coverImg}
          />
        )}
        <View style={styles.veil} />
        <View style={styles.coverTop}>
          {isLive ? (
            <View style={[styles.pill, styles.pillLive]}>
              <View style={styles.pulse} />
              <Text style={styles.pillText}>LIVE</Text>
            </View>
          ) : isScheduled ? (
            <View style={styles.pill} testID="scheduled-badge">
              <Ionicons name="time-outline" size={11} color="#fff" />
              <Text style={styles.pillText}>
                {scheduled_at ? format(new Date(scheduled_at), 'dd MMM · HH:mm') : 'Scheduled'}
              </Text>
            </View>
          ) : <View />}
          {countText ? (
            <View style={styles.pill}>
              <Ionicons name="people" size={11} color="#fff" />
              <Text style={styles.pillText}>{countText}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.typeBadge}>
          <Ionicons name={room_type === 'video' ? 'videocam' : 'mic'} size={16} color="#fff" />
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {description ? (
          <Text style={styles.description} numberOfLines={1}>{description}</Text>
        ) : null}
        <View style={styles.metaRow}>
          {!hideCommunityTag && community_name ? (
            <Text style={styles.metaTag}>{community_name}</Text>
          ) : null}
          {!hideCommunityTag && community_name && creator_display_name ? (
            <Text style={styles.metaDot}>·</Text>
          ) : null}
          {creator_display_name ? (
            <Text style={styles.metaTag}>hosted by {creator_display_name}</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}
