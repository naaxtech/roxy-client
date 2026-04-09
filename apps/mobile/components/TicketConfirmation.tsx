import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { COLORS } from '../lib/constants';

interface Event {
  title: string;
  starts_at: string;
  communities?: { name: string } | null;
}

interface Props {
  event: Event;
  ticketCode: string | null;
  onViewTickets: () => void;
}

export function TicketConfirmation({ event, ticketCode, onViewTickets }: Props) {
  const dateStr = new Date(event.starts_at).toLocaleDateString('en-US', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
  });

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>You're in! 🎉</Text>
      <Text style={styles.eventTitle}>{event.title}</Text>
      <Text style={styles.meta}>{dateStr}</Text>
      {event.communities?.name && (
        <Text style={styles.meta}>{event.communities.name}</Text>
      )}

      {ticketCode ? (
        <>
          <View style={styles.qrContainer}>
            <QRCode value={ticketCode} size={180} backgroundColor={COLORS.surface} color={COLORS.textPrimary} />
          </View>
          <Text style={styles.ticketCode}>{ticketCode}</Text>
        </>
      ) : (
        <Text style={styles.pending}>
          Payment received — your ticket is arriving shortly.
        </Text>
      )}

      <TouchableOpacity style={styles.btn} onPress={onViewTickets}>
        <Text style={styles.btnText}>View in My Tickets</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', padding: 24, backgroundColor: COLORS.surface, borderRadius: 16 },
  heading: { fontSize: 24, fontWeight: '800', color: COLORS.roxy, marginBottom: 8 },
  eventTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center' },
  meta: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  qrContainer: { marginTop: 20, padding: 16, backgroundColor: COLORS.surface, borderRadius: 12 },
  ticketCode: { fontFamily: 'monospace', fontSize: 13, color: COLORS.textMuted, marginTop: 8, letterSpacing: 1 },
  pending: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', marginTop: 20, lineHeight: 20 },
  btn: { marginTop: 24, backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  btnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
});
