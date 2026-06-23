import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { format } from 'date-fns';
import { useThemeColors } from '../hooks/useThemeColors';

interface TicketCardProps {
  eventTitle: string;
  startsAt: string;
  locationText: string | null;
  communityName: string | null;
  ticketCode: string;
  variant?: 'full' | 'collapsed';
  status?: 'active' | 'cancelled' | 'checked_in';
  onExpand?: () => void;
}

export function TicketCard({
  eventTitle,
  startsAt,
  locationText,
  communityName,
  ticketCode,
  variant = 'full',
  status = 'active',
  onExpand,
}: TicketCardProps) {
  const colors = useThemeColors();

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 20,
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.primary + '40',
    },
    cardCancelled: { borderColor: colors.error + '40', opacity: 0.7 },
    going: { color: colors.roxy, fontWeight: '700', fontSize: 14, marginBottom: 4 },
    cancelledLabel: { color: colors.error },
    title: { color: colors.textPrimary, fontWeight: '800', fontSize: 16, textAlign: 'center' },
    strikethrough: { textDecorationLine: 'line-through', color: colors.textMuted },
    date: { color: colors.textSecondary, fontSize: 13 },
    meta: { color: colors.textSecondary, fontSize: 13 },
    qrWrap: {
      backgroundColor: '#fff',
      borderRadius: 12,
      padding: 12,
      marginTop: 8,
      marginBottom: 4,
      position: 'relative',
    },
    qrWrapCheckedIn: { opacity: 0.7 },
    checkedInStamp: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      borderRadius: 12,
      backgroundColor: 'rgba(34,197,94,0.15)',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: '#22c55e',
    },
    checkedInStampText: {
      color: '#22c55e',
      fontWeight: '900',
      fontSize: 18,
      letterSpacing: 2,
      transform: [{ rotate: '-20deg' }],
    },
    code: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.5,
      marginTop: 4,
    },
    cancelledText: { color: colors.textMuted },
    refundNote: {
      color: colors.textMuted,
      fontSize: 12,
      textAlign: 'center',
      marginTop: 4,
      fontStyle: 'italic',
    },

    // Collapsed variant
    collapsed: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.primary + '30',
    },
    collapsedCancelled: { borderColor: colors.error + '30', opacity: 0.7 },
    collapsedLeft: { flex: 1, marginRight: 12 },
    collapsedTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    collapsedDate: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    statusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
    },
    badgeActive: { backgroundColor: colors.primary + '20' },
    badgeCancelled: { backgroundColor: colors.error + '20' },
    badgeCheckedIn: { backgroundColor: '#22c55e20' },
    statusBadgeText: { fontSize: 11, fontWeight: '700', color: colors.textPrimary },
  });

  const isCancelled = status === 'cancelled';
  const isCheckedIn = status === 'checked_in';
  const dateStr = format(new Date(startsAt), 'EEE d MMM · h:mm a');

  if (variant === 'collapsed') {
    return (
      <TouchableOpacity
        style={[styles.collapsed, isCancelled && styles.collapsedCancelled]}
        onPress={onExpand}
        activeOpacity={0.7}
      >
        <View style={styles.collapsedLeft}>
          <Text style={[styles.collapsedTitle, isCancelled && styles.cancelledText]} numberOfLines={1}>
            {eventTitle}
          </Text>
          <Text style={styles.collapsedDate}>{dateStr}</Text>
        </View>
        <View style={[
          styles.statusBadge,
          isCancelled ? styles.badgeCancelled : isCheckedIn ? styles.badgeCheckedIn : styles.badgeActive,
        ]}>
          <Text style={styles.statusBadgeText}>
            {isCancelled ? 'Refunded' : isCheckedIn ? 'Checked In' : 'Going'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.card, isCancelled && styles.cardCancelled]}>
      <Text style={[styles.going, isCancelled && styles.cancelledLabel]}>
        {isCancelled ? '❌ Event Cancelled' : isCheckedIn ? '✅ Checked In' : '🌸 You\'re going!'}
      </Text>
      <Text style={[styles.title, isCancelled && styles.strikethrough]}>{eventTitle}</Text>
      <Text style={styles.date}>{dateStr}</Text>
      {locationText ? <Text style={styles.meta}>📍 {locationText}</Text> : null}
      {communityName ? <Text style={styles.meta}>🏳️‍🌈 {communityName}</Text> : null}

      {!isCancelled && (
        <View style={[styles.qrWrap, isCheckedIn && styles.qrWrapCheckedIn]} testID="ticket-qr">
          <QRCode value={ticketCode} size={160} />
          {isCheckedIn && (
            <View style={styles.checkedInStamp}>
              <Text style={styles.checkedInStampText}>CHECKED IN</Text>
            </View>
          )}
        </View>
      )}

      <Text style={[styles.code, isCancelled && styles.cancelledText]}>{ticketCode}</Text>
      {isCancelled && (
        <Text style={styles.refundNote}>Your refund will appear in 5–10 business days.</Text>
      )}
    </View>
  );
}
