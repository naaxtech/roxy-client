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
import { useThemeColors } from '../../hooks/useThemeColors';
import { TicketCard } from '../../components/TicketCard';
import { TicketConfirmation } from '../../components/TicketConfirmation';
import { LinearGradient } from 'expo-linear-gradient';
import { formatDuration, openCalendar, eventStage, eventCta, eventSafetyLine } from '../../lib/eventUtils';
import { purchaseTicket, subscribeToTicket } from '../../lib/stripe';
import { toggleUserFavorite } from '../../components/profile/ProfileFavorites';
import { EventModeBadge } from '../../components/events/EventModeBadge';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

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
  max_attendees: number | null;
  is_paid: boolean;
  is_private: boolean;
  price_cents: number | null;
  status: 'active' | 'cancelled' | 'completed';
  community_id: string | null;
  communities: { id: string; name: string } | null;
};

export default function EventDetailScreen() {
  const colors = useThemeColors();
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
  const [favorited, setFavorited] = useState(false);
  const ticketAnim = useRef(new Animated.Value(0)).current;
  const ticketSubscriptionUnsubRef = useRef<(() => void) | null>(null);
  const eventChannelRef = useRef<any>(null);

  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  useEffect(() => {
    if (!user?.id || !id) return;
    void supabase
      .from('user_favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('entity_type', 'event')
      .eq('entity_id', id)
      .maybeSingle()
      .then(({ data }) => setFavorited(!!data));
  }, [user?.id, id]);

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
  // ticketAnim is a stable Animated.Value ref — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user]);

  useEffect(() => {
    fetchEvent();
    fetchRsvp();
  }, [fetchEvent, fetchRsvp]);

  // Realtime: update event status when host/staff cancels or event auto-completes
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`event-status:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${id}` },
        (payload) => {
          if (payload.new?.status) {
            setEvent((prev) => prev ? { ...prev, status: payload.new.status } : prev);
          }
        },
      )
      .subscribe();
    eventChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      ticketSubscriptionUnsubRef.current?.();
      if (eventChannelRef.current) supabase.removeChannel(eventChannelRef.current);
    };
  }, []);

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
    // Sold out check
    if (event.max_attendees !== null && event.attendee_count >= event.max_attendees) {
      setPurchaseError('This event is sold out.');
      return;
    }
    setPurchasing(true);
    setPurchaseError(null);

    // Subscribe to ticket delivery BEFORE presenting payment sheet
    ticketSubscriptionUnsubRef.current = subscribeToTicket(event.id, user.id, (code) => {
      animateTicketIn(code);
    });

    const result = await purchaseTicket(event.id, initPaymentSheet, presentPaymentSheet, user.id);
    setPurchasing(false);

    if (result.success) {
      // Show confirmation immediately — ticket arrives via Realtime
      setPurchaseResult({ ticketCode: null });
    } else if (result.soldOut) {
      ticketSubscriptionUnsubRef.current?.();
      ticketSubscriptionUnsubRef.current = null;
      setPurchaseError('Sorry, this event just sold out.');
    } else if (!result.cancelled) {
      ticketSubscriptionUnsubRef.current?.();
      ticketSubscriptionUnsubRef.current = null;
      setPurchaseError(result.error ?? 'Payment failed. Please try again.');
    } else {
      // Cancelled — clean up subscription
      ticketSubscriptionUnsubRef.current?.();
      ticketSubscriptionUnsubRef.current = null;
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

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingBottom: 4,
    },
    backBtn: { paddingVertical: 8 },

    scroll: { paddingHorizontal: 20, paddingBottom: 40, gap: 0 },

    hero: {
      height: 132, borderRadius: RADII.lg, overflow: 'hidden',
      marginBottom: 14, justifyContent: 'space-between',
      paddingHorizontal: 12, paddingVertical: 10,
    },
    heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    saveBtn: {
      minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
      borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.background + '80',
    },
    title: {
      ...TYPE.headline, color: colors.textPrimary, marginBottom: 4,
    },
    communityLink: {
      ...TYPE.body, color: colors.primaryInk, fontWeight: '700', marginBottom: 12,
    },

    metaCard: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
      borderRadius: RADII.lg, paddingHorizontal: 13, paddingVertical: 11,
      gap: 8, marginBottom: 16,
    },
    metaRow: { ...TYPE.body, color: colors.textSecondary, fontWeight: '600' },
    metaStrong: { color: colors.textPrimary, fontWeight: '700' },
    metaLink: { color: colors.primaryInk, textDecorationLine: 'underline' },
    metaFree: { color: colors.successInk },
    metaPaid: { color: colors.goldInk },

    descBlock: { marginBottom: 14 },
    descLabel: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '800', letterSpacing: 0.8 },
    desc: { ...TYPE.body, color: colors.textSecondary, lineHeight: 20 },
    safety: {
      backgroundColor: colors.surfaceLight, borderWidth: 1, borderColor: colors.line,
      borderRadius: RADII.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
    },
    safetyText: { ...TYPE.caption, color: colors.secondaryInk, fontWeight: '600', lineHeight: 17 },

    divider: {
      height: 1, backgroundColor: colors.surface,
      marginVertical: 20,
    },

    cancelledBanner: {
      backgroundColor: colors.error + '15',
      borderRadius: 12,
      padding: 16,
      marginVertical: 16,
      borderWidth: 1,
      borderColor: colors.error + '40',
    },
    cancelledBannerText: { color: colors.error, fontWeight: '700', fontSize: 15, textAlign: 'center' },
    cancelledBannerSub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 4 },

    soldOutBtn: {
      marginTop: 24, borderRadius: 14, paddingVertical: 16,
      alignItems: 'center', backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.textMuted + '40',
    },
    soldOutText: { color: colors.textMuted, fontWeight: '700', fontSize: 16 },

    calendarBtn: {
      marginTop: 12, alignSelf: 'center',
      paddingHorizontal: 20, paddingVertical: 10,
      borderRadius: 20, borderWidth: 1, borderColor: colors.primary + '60',
    },
    calendarBtnText: { color: colors.primary, fontWeight: '600', fontSize: 14 },

    rsvpRow: {
      flexDirection: 'row', alignItems: 'center',
      gap: 12, marginTop: 24,
    },
    goingPill: {
      flex: 1, backgroundColor: colors.primary,
      borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    },
    goingPillText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    cancelBtn: {
      paddingHorizontal: 16, paddingVertical: 14,
      borderRadius: 14, borderWidth: 1, borderColor: colors.surface,
    },
    cancelBtnText: { color: colors.textMuted, fontWeight: '600', fontSize: 14 },

    rsvpBtn: {
      marginTop: 24, backgroundColor: colors.primary,
      borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    },
    rsvpBtnDisabled: { opacity: 0.6 },
    rsvpBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    errorText: { color: colors.error, fontSize: 13, marginTop: 8, textAlign: 'center' },

    notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    notFoundText: { color: colors.textSecondary, fontSize: 15 },
    notFoundBack: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
      </SafeAreaView>
    );
  }

  if (notFound || !event) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
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

  // An online event is not a static RSVP — the design turns it into a room she
  // can walk into at start time. Nothing read the clock before this, so an
  // event she had RSVP'd to looked identical five minutes before it began and
  // an hour after it ended.
  const stage = eventStage(event.starts_at, event.ends_at);
  const isOnline = event.event_type === 'online' || event.event_type === 'hybrid';
  const canJoinNow = isOnline && stage === 'live' && !!event.location_url;
  const going = ticketCode !== null;
  const isSoldOut = event.max_attendees !== null && event.attendee_count >= event.max_attendees;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={isOnline ? [colors.backgroundAlt, colors.secondary] : [colors.backgroundAlt, colors.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
          testID="event-hero"
        >
          <View style={styles.heroTop}>
            <EventModeBadge mode={event.event_type} />
            {user ? (
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={async () => {
                  const on = await toggleUserFavorite(user.id, 'event', event.id);
                  setFavorited(on);
                }}
                accessibilityRole="button"
                accessibilityLabel={favorited ? 'Remove event from saved' : 'Save event'}
                testID="event-save"
              >
                <Ionicons
                  name={favorited ? 'heart' : 'heart-outline'}
                  size={20}
                  color={favorited ? colors.primary : inkOn(colors.backgroundAlt)}
                />
              </TouchableOpacity>
            ) : null}
          </View>
        </LinearGradient>

        <Text style={styles.title}>{event.title}</Text>

        {event.communities && (
          <TouchableOpacity
            onPress={() => router.push(`/community/${event.community_id}` as any)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${event.communities.name}`}
          >
            <Text style={styles.communityLink}>hosted by {event.communities.name} →</Text>
          </TouchableOpacity>
        )}

        <View style={styles.metaCard} testID="event-meta">
          <Text style={styles.metaRow}>
            <Text style={styles.metaStrong}>
              {format(new Date(event.starts_at), 'EEE d MMM · h:mm a')}
            </Text>
            {duration ? ` · ${duration}` : ''}
          </Text>
          {event.location_text ? (
            <TouchableOpacity
              disabled={!event.location_url}
              onPress={() => event.location_url
                ? Linking.openURL(event.location_url!).catch(() => {})
                : undefined
              }
              accessibilityRole={event.location_url ? 'link' : 'text'}
              accessibilityLabel={event.location_text}
            >
              <Text style={[styles.metaRow, event.location_url ? styles.metaLink : styles.metaStrong]}>
                {event.location_text}
              </Text>
            </TouchableOpacity>
          ) : isOnline ? (
            <Text style={styles.metaRow}>Doors open 10 min early</Text>
          ) : null}
          <Text style={styles.metaRow}>
            <Text style={styles.metaStrong}>{event.attendee_count} going</Text>
            <Text style={[styles.metaRow, event.is_paid ? styles.metaPaid : styles.metaFree]}>
              {' · '}{event.is_paid ? 'Paid' : 'Free'}
            </Text>
          </Text>
        </View>

        {event.description ? (
          <View style={styles.descBlock}>
            <Text style={styles.desc}>
              <Text style={styles.descLabel}>ABOUT · </Text>
              {event.description}
            </Text>
          </View>
        ) : null}

        <View style={styles.safety} testID="event-safety">
          <Text style={styles.safetyText}>
            {eventSafetyLine({
              event_type: event.event_type,
              is_private: event.is_private,
              communityName: event.communities?.name ?? null,
            })}
          </Text>
        </View>

        {/* Cancelled banner */}
        {event.status === 'cancelled' && (
          <View style={styles.cancelledBanner}>
            <Text style={styles.cancelledBannerText}>
              ❌ This event was cancelled.
            </Text>
            {ticketCode && (
              <Text style={styles.cancelledBannerSub}>
                Your refund will appear in 5–10 business days.
              </Text>
            )}
          </View>
        )}

        {going ? (
          <Animated.View style={{ opacity: ticketAnim }}>
            <View style={styles.divider} />
            <TicketCard
              eventTitle={event.title}
              startsAt={event.starts_at}
              locationText={event.location_text}
              communityName={event.communities?.name ?? null}
              ticketCode={ticketCode!}
              status={event.status === 'cancelled' ? 'cancelled' : 'active'}
            />
            {event.status !== 'cancelled' && (
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
            )}
          </Animated.View>
        ) : null}

        {/* Buy ticket / sold out / RSVP area — only shown when event is active and not going */}
        {event.status === 'active' && !going && event.is_paid && (
          <View>
            {isSoldOut ? (
              <View style={styles.soldOutBtn}>
                <Text style={styles.soldOutText}>Sold Out</Text>
              </View>
            ) : purchaseResult ? (
              <TicketConfirmation
                event={event}
                ticketCode={purchaseResult.ticketCode}
                onViewTickets={() => router.push('/tickets' as any)}
              />
            ) : (
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
            )}
            {purchaseError && <Text style={styles.errorText}>{purchaseError}</Text>}
          </View>
        )}

        {/* Live now: the room is open, so the door is the primary action —
            offered to anyone who finds it running, not only to women who
            RSVP'd. Refusing her entry to something already open helps nobody. */}
        {event.status === 'active' && canJoinNow && (
          <TouchableOpacity
            style={styles.rsvpBtn}
            onPress={() => { if (event.location_url) void Linking.openURL(event.location_url); }}
            accessibilityRole="button"
            accessibilityLabel={`${eventCta(stage, going, !!event.is_paid)} — opens the event room`}
            testID="event-join-now"
          >
            <Text style={styles.rsvpBtnText}>{eventCta(stage, going, !!event.is_paid)}</Text>
          </TouchableOpacity>
        )}

        {event.status === 'active' && stage === 'ended' && (
          <Text style={styles.errorText} testID="event-ended">
            {eventCta('ended', going, !!event.is_paid)}
          </Text>
        )}

        {event.status === 'active' && !canJoinNow && stage !== 'ended' && !going && !event.is_paid && (
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

        {event.status === 'active' && going && !event.is_paid && (
          <View style={styles.rsvpRow}>
            <View style={styles.goingPill}>
              <Text style={styles.goingPillText}>You're going ✓</Text>
            </View>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

