import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Animated, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { format } from 'date-fns';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { COLORS } from '../../lib/constants';
import { TicketCard } from '../../components/TicketCard';
import { TicketConfirmation } from '../../components/TicketConfirmation';
import { formatDuration, openCalendar } from '../../lib/eventUtils';
import { purchaseTicket } from '../../lib/stripe';

type EventDetail = {
  id: string;
  title: string;
  description: string | null;
  event_type: 'online' | 'in_person' | 'hybrid';
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  location_url: string | null;
  attendee_count: number;
  is_paid: boolean;
  is_private: boolean;
  price_cents: number | null;
  community_id: string | null;
  communities: { id: string; name: string } | null;
};

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [ticketCode, setTicketCode] = useState<string | null>(null);
  const [rsvping, setRsvping] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseResult, setPurchaseResult] = useState<{ ticketCode: string | null } | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const ticketAnim = useRef(new Animated.Value(0)).current;

  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const fetchEvent = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from('events')
      .select('*, price_cents, communities(id, name)')
      .eq('id', id)
      .single();
    if (error || !data) { setNotFound(true); setLoading(false); return; }
    setEvent(data as EventDetail);
    setLoading(false);
  }, [id]);

  const fetchRsvp = useCallback(async () => {
    if (!id || !user) return;
    const { data } = await supabase
      .from('event_attendees')
      .select('ticket_code, status')
      .eq('event_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (data?.ticket_code) {
      setTicketCode(data.ticket_code);
      ticketAnim.setValue(1);
    }
  }, [id, user]);

  useEffect(() => {
    fetchEvent();
    fetchRsvp();
  }, [fetchEvent, fetchRsvp]);

  const animateTicketIn = (code: string) => {
    setTicketCode(code);
    Animated.timing(ticketAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  };

  const handleRsvp = async () => {
    if (!event || !user || rsvping) return;
    setRsvping(true);
    const { data, error } = await supabase
      .from('event_attendees')
      .insert({ event_id: event.id, user_id: user.id, status: 'going' })
      .select('ticket_code')
      .single();
    setRsvping(false);
    if (!error && data?.ticket_code) animateTicketIn(data.ticket_code);
  };

  const handleBuyTicket = async () => {
    if (!event || !user) return;
    setPurchasing(true);
    setPurchaseError(null);
    const result = await purchaseTicket(event.id, initPaymentSheet, presentPaymentSheet, user.id);
    setPurchasing(false);
    if (result.success) {
      setPurchaseResult({ ticketCode: result.ticketCode ?? null });
    } else if (!result.cancelled) {
      setPurchaseError(result.error ?? 'Payment failed. Please try again.');
    }
  };

  const handleCancel = async () => {
    if (!event || !user) return;
    await supabase
      .from('event_attendees')
      .delete()
      .eq('event_id', event.id)
      .eq('user_id', user.id);
    setTicketCode(null);
    ticketAnim.setValue(0);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
      </SafeAreaView>
    );
  }

  if (notFound || !event) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>This event is no longer available.</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.notFoundBack}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const duration = formatDuration(event.starts_at, event.ends_at);
  const going = ticketCode !== null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{event.title}</Text>

        {event.communities && (
          <TouchableOpacity onPress={() => router.push(`/community/${event.community_id}` as any)}>
            <Text style={styles.communityLink}>🏳️‍🌈 {event.communities.name}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.metaBlock}>
          <Text style={styles.metaRow}>
            🗓  {format(new Date(event.starts_at), 'EEE d MMM · h:mm a')}
          </Text>
          {duration && <Text style={styles.metaRow}>⏱  {duration}</Text>}
          {event.location_text && (
            <TouchableOpacity
              disabled={!event.location_url}
              onPress={() => event.location_url
                ? Linking.openURL(event.location_url!).catch(() => {})
                : undefined
              }
            >
              <Text style={[styles.metaRow, event.location_url ? styles.metaLink : null]}>
                📍  {event.location_text}
              </Text>
            </TouchableOpacity>
          )}
          <Text style={styles.metaRow}>👥  {event.attendee_count} going</Text>
          <Text style={[styles.metaRow, event.is_paid ? styles.metaPaid : styles.metaFree]}>
            🎟  {event.is_paid ? 'Paid' : 'Free'}
          </Text>
        </View>

        {event.description ? (
          <View style={styles.descBlock}>
            <Text style={styles.descLabel}>About</Text>
            <Text style={styles.desc}>{event.description}</Text>
          </View>
        ) : null}

        {going ? (
          <Animated.View style={{ opacity: ticketAnim }}>
            <View style={styles.divider} />
            <TicketCard
              eventTitle={event.title}
              startsAt={event.starts_at}
              locationText={event.location_text}
              communityName={event.communities?.name ?? null}
              ticketCode={ticketCode!}
            />
            <TouchableOpacity
              style={styles.calendarBtn}
              onPress={() => openCalendar({
                title: event.title,
                startsAt: event.starts_at,
                endsAt: event.ends_at,
                locationText: event.location_text,
                communityName: event.communities?.name ?? null,
              })}
            >
              <Text style={styles.calendarBtnText}>+ Add to Calendar</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : null}

        {purchaseResult ? (
          <TicketConfirmation
            event={event}
            ticketCode={purchaseResult.ticketCode}
            onViewTickets={() => router.push('/(tabs)/grow')}
          />
        ) : event.is_paid ? (
          <View>
            <TouchableOpacity
              style={[styles.rsvpBtn, purchasing && styles.rsvpBtnDisabled]}
              onPress={handleBuyTicket}
              disabled={purchasing}
            >
              {purchasing
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.rsvpBtnText}>
                    {`Buy Ticket — $${((event.price_cents ?? 0) / 100).toFixed(2)}`}
                  </Text>
              }
            </TouchableOpacity>
            {purchaseError && (
              <Text style={styles.errorText}>{purchaseError}</Text>
            )}
          </View>
        ) : going ? (
          <View style={styles.rsvpRow}>
            <View style={styles.goingPill}>
              <Text style={styles.goingPillText}>You're going ✓</Text>
            </View>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.rsvpBtn, rsvping && styles.rsvpBtnDisabled]}
            onPress={handleRsvp}
            disabled={rsvping}
          >
            {rsvping
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.rsvpBtnText}>RSVP — It's Free</Text>
            }
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  backBtn: { padding: 16, paddingBottom: 4 },

  scroll: { paddingHorizontal: 20, paddingBottom: 40, gap: 0 },

  title: {
    color: COLORS.textPrimary, fontSize: 22, fontWeight: '800',
    marginTop: 8, marginBottom: 6,
  },
  communityLink: {
    color: COLORS.primary, fontSize: 14, fontWeight: '600', marginBottom: 16,
  },

  metaBlock: { gap: 8, marginBottom: 20 },
  metaRow: { color: COLORS.textSecondary, fontSize: 14 },
  metaLink: { color: COLORS.primary, textDecorationLine: 'underline' },
  metaFree: { color: COLORS.success },
  metaPaid: { color: COLORS.warning },

  descBlock: { marginBottom: 24 },
  descLabel: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 8 },
  desc: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22 },

  divider: {
    height: 1, backgroundColor: COLORS.surface,
    marginVertical: 20,
  },

  calendarBtn: {
    marginTop: 12, alignSelf: 'center',
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1, borderColor: COLORS.primary + '60',
  },
  calendarBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: 14 },

  rsvpRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, marginTop: 24,
  },
  goingPill: {
    flex: 1, backgroundColor: COLORS.primary,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  goingPillText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: {
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 14, borderWidth: 1, borderColor: COLORS.surface,
  },
  cancelBtnText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 14 },

  rsvpBtn: {
    marginTop: 24, backgroundColor: COLORS.primary,
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  rsvpBtnDisabled: { opacity: 0.6 },
  rsvpBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  errorText: { color: COLORS.error, fontSize: 13, marginTop: 8, textAlign: 'center' },

  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFoundText: { color: COLORS.textSecondary, fontSize: 15 },
  notFoundBack: { color: COLORS.primary, fontWeight: '600', fontSize: 14 },
});
