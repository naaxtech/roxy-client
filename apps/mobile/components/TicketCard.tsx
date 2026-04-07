import { View, Text, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { format } from 'date-fns';
import { COLORS } from '../lib/constants';

interface TicketCardProps {
  eventTitle: string;
  startsAt: string;
  locationText: string | null;
  communityName: string | null;
  ticketCode: string;
}

export function TicketCard({ eventTitle, startsAt, locationText, communityName, ticketCode }: TicketCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.going}>🌸 You're going!</Text>
      <Text style={styles.title}>{eventTitle}</Text>
      <Text style={styles.date}>{format(new Date(startsAt), 'EEE d MMM · h:mm a')}</Text>
      {locationText ? <Text style={styles.meta}>📍 {locationText}</Text> : null}
      {communityName ? <Text style={styles.meta}>🏳️‍🌈 {communityName}</Text> : null}
      <View style={styles.qrWrap} testID="ticket-qr">
        <QRCode value={ticketCode} size={160} />
      </View>
      <Text style={styles.code}>{ticketCode}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  going: { color: COLORS.roxy, fontWeight: '700', fontSize: 14, marginBottom: 4 },
  title: { color: COLORS.textPrimary, fontWeight: '800', fontSize: 16, textAlign: 'center' },
  date: { color: COLORS.textSecondary, fontSize: 13 },
  meta: { color: COLORS.textSecondary, fontSize: 13 },
  qrWrap: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  code: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 4,
  },
});
