import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated, Linking, Platform, Share,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ExpoLinking from 'expo-linking';
import { PressableScale } from '../../components/ui/PressableScale';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { format } from 'date-fns';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { TicketConfirmation } from '../../components/TicketConfirmation';
import { openCalendar, eventStage, eventCta, eventSafetyLine } from '../../lib/eventUtils';
import { animatedSpring } from '../../lib/motion';
import { purchaseTicket, subscribeToTicket } from '../../lib/stripe';
import { toggleUserFavorite } from '../../components/profile/ProfileFavorites';
import { EventPoster } from '../../components/events/EventPoster';
import { GoingSeal, SEAL_TILT } from '../../components/events/GoingSeal';
import { TYPE, TABULAR } from '../../lib/typography';
import { RADII } from '../../lib/theme';
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

/** How far below its corner the seal starts: roughly where "I'm going" sits. */
const SEAL_TRAVEL = 420;

/** The words under the share button, true by construction (see `bringAFriend`). */
export const SHARE_PRIVACY_COPY = 'The link preview won’t name the event or the club.';

/** The medium thump when the seal lands (direction › Haptics). Never on the web. */
function sealLanded(): void {
  if (Platform.OS === 'web') return;
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)?.catch?.(() => undefined);
  } catch {
    // No haptics engine in this client. The seal still lands.
  }
}

/** "Friday 5 December, 8:30 – 10:00 pm" — the day and the span, in words. */
function whenLine(startsAt: string, endsAt: string | null): string {
  const start = new Date(startsAt);
  if (!endsAt) return format(start, 'EEEE d MMMM, h:mm aaa');
  const end = new Date(endsAt);
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${format(start, 'EEEE d MMMM, h:mm')} – ${format(end, 'h:mm aaa')}`
    : `${format(start, 'EEEE d MMMM, h:mm aaa')} – ${format(end, 'EEEE d MMMM, h:mm aaa')}`;
}

/**
 * One event, as a poster (design direction v2 › signature moment 3, board
 * v2-03).
 *
 * The poster leads: the community's identity colour, the title at `moment`.
 * "I'm going" (the one lipped primary) RSVPs; the 16-point seal then springs
 * from the button into the poster's top corner and stamps at 9° on
 * `SPRING.slowSpatial`, and a medium haptic lands with it. The ticket row
 * appears with the code in mono. Once she is going, the primary becomes
 * "Bring a friend": a share whose text and link name neither the event nor
 * the club.
 *
 * Privacy rules this screen keeps:
 * - The exact place is only on her ticket. Before she is going, an in-person
 *   event says "The exact meeting point is on your ticket."
 * - Who is going is never listed here; the screen shows the count only. (RLS
 *   lets a member read her own attendee row only, so a going-only guest list
 *   needs a backend change first — reported, not faked.)
 *
 * Every v0 flow stays: save, paid tickets (Stripe sheet, sold out, the
 * confirmation), joining a live online room, ended and cancelled states,
 * giving up a free spot, add to calendar, opening the hosting community.
 */
export default function EventDetailScreen() {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [ticketCode, setTicketCode] = useState<string | null>(null);
  const [rsvping, setRsvping] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseResult, setPurchaseResult] = useState<{ ticketCode: string | null } | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [favorited, setFavorited] = useState(false);
  // 0 = no seal, 1 = stamped on the poster's corner.
  const seal = useRef(new Animated.Value(0)).current;
  const ticketSubscriptionUnsubRef = useRef<(() => void) | null>(null);
  const eventChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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
      // Already going when she arrives: the seal is simply there. No
      // celebration for something she did yesterday.
      setTicketCode(data.ticket_code);
      seal.setValue(1);
    }
  // seal is a stable Animated.Value ref — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user]);

  useEffect(() => {
    void fetchEvent();
    void fetchRsvp();
  }, [fetchEvent, fetchRsvp]);

  // Realtime: update event status when host/staff cancels or event auto-completes
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`event-status:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${id}` },
        (payload: { new?: { status?: EventDetail['status'] } }) => {
          if (payload.new?.status) {
            const next = payload.new.status;
            setEvent((prev) => prev ? { ...prev, status: next } : prev);
          }
        },
      )
      .subscribe();
    eventChannelRef.current = channel;
    return () => { void supabase.removeChannel(channel); };
  }, [id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      ticketSubscriptionUnsubRef.current?.();
      if (eventChannelRef.current) void supabase.removeChannel(eventChannelRef.current);
    };
  }, []);

  /** The ticket arrived: stamp the seal (moment 3). */
  const stampSeal = (code: string) => {
    setTicketCode(code);
    if (reduced) {
      seal.setValue(1);
      sealLanded();
      return;
    }
    seal.setValue(0);
    Animated.spring(seal, { toValue: 1, ...animatedSpring('slowSpatial') }).start(({ finished }) => {
      if (finished) sealLanded();
    });
  };

  const handleRsvp = async () => {
    if (!event || !user || rsvping) return;
    setRsvping(true);
    setRsvpError(null);
    const { data, error } = await supabase
      .from('event_attendees')
      .insert({ event_id: event.id, user_id: user.id, status: 'going' })
      .select('ticket_code')
      .single();
    setRsvping(false);
    if (!error && data?.ticket_code) stampSeal(data.ticket_code);
    else setRsvpError('That didn’t go through. Check your connection and try again.');
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
      stampSeal(code);
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
    seal.setValue(0);
  };

  /**
   * "Bring a friend": the link only. A share preview must never name the
   * event or the club (design direction › Privacy outside the app), so the
   * text carries no title and no community, just the way in.
   */
  const bringAFriend = () => {
    if (!event) return;
    const url = ExpoLinking.createURL(`/event/${event.id}`);
    void Share.share({ message: `Come with me? ${url}`, url }).catch(() => { /* dismissed */ });
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.ground },
    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 8,
    },
    topEnd: { flexDirection: 'row', alignItems: 'center' },
    iconBtn: {
      minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center', justifyContent: 'center',
    },
    scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 24 },
    info: { gap: 16 },
    row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { ...TYPE.label, color: colors.ink },
    rowBody: { ...TYPE.body, color: colors.ink2 },
    link: { ...TYPE.label, color: colors.pinkInk },
    about: { gap: 8 },
    aboutTitle: { ...TYPE.title, color: colors.ink },
    aboutBody: { ...TYPE.body, color: colors.ink2 },
    safety: { ...TYPE.meta, color: colors.ink3 },
    ticket: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: colors.surface, borderRadius: RADII.md, padding: 16,
    },
    check: {
      width: 40, height: 40, borderRadius: RADII.pill, backgroundColor: colors.success,
      alignItems: 'center', justifyContent: 'center',
    },
    ticketText: { flex: 1, gap: 2 },
    ticketTitle: { ...TYPE.label, color: colors.ink },
    ticketCode: { ...TYPE.mono, ...TABULAR, color: colors.ink2 },
    ticketPlace: { ...TYPE.body, color: colors.ink2 },
    ticketOpen: { minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, justifyContent: 'center', alignItems: 'flex-end' },
    actions: { gap: 4 },
    note: { ...TYPE.meta, color: colors.ink2, textAlign: 'center' },
    quiet: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignItems: 'center' },
    quietText: { ...TYPE.label, color: colors.ink2 },
    error: { ...TYPE.body, color: colors.dangerInk, textAlign: 'center' },
    banner: { backgroundColor: colors.raised, borderRadius: RADII.md, padding: 16, gap: 4 },
    bannerTitle: { ...TYPE.label, color: colors.dangerInk },
    bannerBody: { ...TYPE.body, color: colors.ink2 },
    soldOut: { ...TYPE.label, color: colors.ink3, textAlign: 'center', paddingVertical: 16 },
    // Skeleton at the poster's final size while loading (no spinner).
    skeletonPoster: { height: 320, borderRadius: RADII.md, backgroundColor: colors.raised },
    skeletonLine: { height: 16, borderRadius: RADII.sm, backgroundColor: colors.raised },
    notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
    notFoundText: { ...TYPE.body, color: colors.ink2, textAlign: 'center' },
  });

  const backButton = (
    <PressableScale
      style={s.iconBtn}
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <Ionicons name="arrow-back" size={24} color={colors.ink} />
    </PressableScale>
  );

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.topBar}>{backButton}</View>
        <View style={s.scroll} testID="event-loading" accessibilityLabel="Loading the event">
          <View style={s.skeletonPoster} />
          <View style={[s.skeletonLine, { width: '70%' }]} />
          <View style={[s.skeletonLine, { width: '50%' }]} />
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !event) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.topBar}>{backButton}</View>
        <View style={s.notFound}>
          <Text style={s.notFoundText}>This event is no longer available.</Text>
          <PressableScale style={s.quiet} onPress={() => router.back()} accessibilityRole="button">
            <Text style={s.link}>Go back</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    );
  }

  // An online event is not a static RSVP — it turns into a room she can walk
  // into at start time.
  const stage = eventStage(event.starts_at, event.ends_at);
  const isOnline = event.event_type === 'online' || event.event_type === 'hybrid';
  const inPerson = event.event_type === 'in_person' || event.event_type === 'hybrid';
  const canJoinNow = isOnline && stage === 'live' && !!event.location_url;
  const going = ticketCode !== null;
  const isSoldOut = event.max_attendees !== null && event.attendee_count >= event.max_attendees;
  const active = event.status === 'active';
  const upcoming = active && stage === 'upcoming';

  const modeTitle = event.event_type === 'online' ? 'Online'
    : event.event_type === 'hybrid' ? 'In person and online' : 'In person';
  const modeBody = !inPerson
    ? 'The room opens here 10 minutes before it starts.'
    : going ? (event.location_text ? 'The exact meeting point is on your ticket below.' : 'The host will share the meeting point.')
      : 'The exact meeting point is on your ticket.';

  const sealStyle = {
    opacity: seal.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
    transform: [
      { translateY: seal.interpolate({ inputRange: [0, 1], outputRange: [SEAL_TRAVEL, 0] }) },
      { scale: seal.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
      { rotate: seal.interpolate({ inputRange: [0, 1], outputRange: ['0deg', SEAL_TILT] }) },
    ],
  };

  const price = `$${((event.price_cents ?? 0) / 100).toFixed(2)}`;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.topBar}>
        {backButton}
        <View style={s.topEnd}>
          {user ? (
            <PressableScale
              style={s.iconBtn}
              onPress={async () => {
                const on = await toggleUserFavorite(user.id, 'event', event.id);
                setFavorited(on);
              }}
              accessibilityRole="button"
              accessibilityLabel={favorited ? 'Remove event from saved' : 'Save event'}
              testID="event-save"
            >
              <Ionicons name={favorited ? 'bookmark' : 'bookmark-outline'} size={24} color={favorited ? colors.pinkInk : colors.ink} />
            </PressableScale>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <EventPoster
          title={event.title}
          identityKey={event.community_id ?? event.id}
          communityName={event.communities?.name ?? null}
          onOpenCommunity={event.community_id ? () => router.push(`/community/${event.community_id}` as never) : undefined}
          startsAt={event.starts_at}
          testID="event-poster"
          seal={going ? (
            <Animated.View style={sealStyle} testID="event-seal">
              <GoingSeal />
            </Animated.View>
          ) : null}
        />

        {event.status === 'cancelled' ? (
          <View style={s.banner} testID="event-cancelled" accessibilityRole="alert">
            <Text style={s.bannerTitle}>This event was cancelled.</Text>
            {ticketCode ? <Text style={s.bannerBody}>Your refund will appear in 5–10 business days.</Text> : null}
          </View>
        ) : null}

        <View style={s.info} testID="event-meta">
          <View style={s.row}>
            <Ionicons name="calendar-outline" size={24} color={colors.ink2} />
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{whenLine(event.starts_at, event.ends_at)}</Text>
              {active ? (
                <PressableScale
                  onPress={() => openCalendar({
                    title: event.title,
                    startsAt: event.starts_at,
                    endsAt: event.ends_at,
                    // The exact place goes into her calendar only once she holds a ticket.
                    locationText: going ? event.location_text : null,
                    communityName: event.communities?.name ?? null,
                  })}
                  accessibilityRole="button"
                  style={{ alignSelf: 'flex-start', minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
                  testID="event-add-calendar"
                >
                  <Text style={s.link}>Add to calendar</Text>
                </PressableScale>
              ) : null}
            </View>
          </View>

          <View style={s.row}>
            <Ionicons name={inPerson ? 'location-outline' : 'videocam-outline'} size={24} color={colors.ink2} />
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{modeTitle}</Text>
              <Text style={s.rowBody}>{modeBody}</Text>
            </View>
          </View>

          <View style={s.row}>
            <Ionicons name="lock-closed-outline" size={24} color={colors.ink2} />
            <View style={s.rowText}>
              <Text style={[s.rowTitle, TABULAR]}>{`${event.attendee_count} going`}</Text>
              <Text style={s.rowBody}>Who’s going isn’t shown here.</Text>
            </View>
          </View>
        </View>

        {going ? (
          <View style={s.ticket} testID="event-ticket">
            <View style={s.check}>
              <Ionicons name="checkmark" size={24} color={colors.surface} />
            </View>
            <View style={s.ticketText}>
              <Text style={s.ticketTitle}>Your ticket</Text>
              <Text style={s.ticketCode} selectable>{ticketCode}</Text>
              {inPerson && event.location_text ? (
                <Text style={s.ticketPlace} testID="event-ticket-place">{event.location_text}</Text>
              ) : null}
            </View>
            <PressableScale
              onPress={() => router.push('/tickets' as never)}
              style={s.ticketOpen}
              accessibilityRole="button"
              accessibilityLabel="Open your ticket"
              testID="event-ticket-open"
            >
              <Text style={s.link}>Open</Text>
            </PressableScale>
          </View>
        ) : null}

        <View style={s.actions}>
          {/* Live now: the room is open, so the door is the primary action —
              offered to anyone who finds it running. */}
          {active && canJoinNow ? (
            <PrimaryButton
              testID="event-join-now"
              label={eventCta(stage, going, !!event.is_paid)}
              onPress={() => { if (event.location_url) void Linking.openURL(event.location_url); }}
              accessibilityHint="Opens the event room"
            />
          ) : null}

          {active && stage === 'ended' ? (
            <Text style={s.note} testID="event-ended">{eventCta('ended', going, !!event.is_paid)}</Text>
          ) : null}

          {upcoming && !going && !event.is_paid ? (
            <PrimaryButton
              testID="event-rsvp"
              label="I’m going"
              onPress={() => void handleRsvp()}
              busy={rsvping}
              accessibilityLabel="I'm going"
              accessibilityHint="Saves your spot and gives you a ticket"
            />
          ) : null}

          {upcoming && !going && event.is_paid ? (
            isSoldOut ? (
              <Text style={s.soldOut}>Sold out</Text>
            ) : purchaseResult ? (
              <TicketConfirmation
                event={event}
                ticketCode={purchaseResult.ticketCode}
                onViewTickets={() => router.push('/tickets' as never)}
              />
            ) : (
              <PrimaryButton
                testID="event-buy"
                label={`Get a ticket · ${price}`}
                onPress={() => void handleBuyTicket()}
                busy={purchasing}
              />
            )
          ) : null}

          {upcoming && going && !canJoinNow ? (
            <>
              <PrimaryButton testID="event-bring-friend" label="Bring a friend" onPress={bringAFriend} />
              <Text style={s.note}>{SHARE_PRIVACY_COPY}</Text>
            </>
          ) : null}

          {rsvpError ? <Text style={s.error} accessibilityRole="alert">{rsvpError}</Text> : null}
          {purchaseError ? <Text style={s.error} accessibilityRole="alert">{purchaseError}</Text> : null}

          {upcoming && going && !event.is_paid ? (
            <PressableScale
              style={s.quiet}
              onPress={() => void handleCancel()}
              accessibilityRole="button"
              testID="event-cancel-rsvp"
            >
              <Text style={s.quietText}>Can’t make it? Give up your spot</Text>
            </PressableScale>
          ) : null}
        </View>

        {event.description ? (
          <View style={s.about}>
            <Text style={s.aboutTitle}>About</Text>
            <Text style={s.aboutBody}>{event.description}</Text>
          </View>
        ) : null}

        <Text style={s.safety} testID="event-safety">
          {eventSafetyLine({
            event_type: event.event_type,
            is_private: event.is_private,
            communityName: event.communities?.name ?? null,
          })}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
