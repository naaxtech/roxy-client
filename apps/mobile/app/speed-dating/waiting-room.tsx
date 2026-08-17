import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { callEdgeFunction, supabase } from '../../lib/supabase';
import { confirmAction } from '../../lib/confirm';
import { logError } from '../../lib/errorLogger';
import { useAuthStore } from '../../store/authStore';
import { useThemeColors } from '../../hooks/useThemeColors';

// A queue join that has found nobody in this long is not going to. Sitting on
// an infinite spinner reads as "the app is broken" -- which is exactly how this
// screen behaved before, since nothing ever ended the wait.
//
// This is a COSMETIC deadline: it changes what the user reads, never whether
// her place in the queue survives. The heartbeat below is what keeps the row
// alive, and it runs for as long as this screen is mounted.
const QUEUE_TIMEOUT_MS = 90_000;

// Every beat refreshes speed_date_sessions.last_seen_at and reports the row's
// status in the same round trip. The server retires a row after 120s of silence
// (join-speed-date-session/index.ts STALE_QUEUE_SECONDS), so this is a 40-beat
// margin -- a dropped packet or two can never cost someone their place.
const HEARTBEAT_MS = 3_000;

// A rejoin costs a Claude call (the edge function generates prompts for a new
// session) and a unit of the 60/day join budget, so the screen will not do it
// unattended forever. After this many it stops and asks.
const MAX_AUTO_REJOINS = 3;

interface QueueHeartbeatRow {
  session_status: 'scheduled' | 'active' | 'completed';
  room_url: string | null;
}

interface JoinQueueResponse {
  session_id: string;
  status: 'waiting' | 'active';
  room_url: string | null;
  participant_count: number;
}

export default function SpeedDateWaitingRoom() {
  const { session_id, communityId, communityName } = useLocalSearchParams<{
    session_id: string;
    communityId?: string;
    communityName?: string;
  }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const colors = useThemeColors();
  const [dots, setDots] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const [waitAttempt, setWaitAttempt] = useState(0);
  const [rejoining, setRejoining] = useState(false);
  const [lostPlace, setLostPlace] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const navigatedRef = useRef(false);
  const rejoiningRef = useRef(false);
  const autoRejoinsRef = useRef(0);
  const lostPlaceRef = useRef(false);
  const rejoinRef = useRef<(auto: boolean) => void>(() => {});

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: 32, gap: 12,
    },
    iconWrap: {
      width: 80, height: 80, borderRadius: 40,
      backgroundColor: colors.primary + '20',
      alignItems: 'center', justifyContent: 'center',
      marginBottom: 8,
      borderWidth: 2, borderColor: colors.primary + '40',
    },
    icon: { fontSize: 36 },
    title: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center' },
    subtitle: {
      color: colors.textSecondary, fontSize: 14, textAlign: 'center',
      lineHeight: 20, maxWidth: 280,
    },
    hint: {
      color: colors.textMuted, fontSize: 13, textAlign: 'center',
      lineHeight: 18, maxWidth: 260, marginTop: 16,
    },
    cancelBtn: {
      marginHorizontal: 32, marginBottom: 24,
      borderWidth: 1, borderColor: colors.textMuted + '60',
      borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    },
    cancelText: { color: colors.textMuted, fontWeight: '600', fontSize: 15 },
    retryBtn: {
      marginTop: 8, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28,
      backgroundColor: colors.roxy + '22',
      borderWidth: 1, borderColor: colors.roxy + '55',
      minHeight: 46, minWidth: 150,
      alignItems: 'center', justifyContent: 'center',
    },
    retryText: { color: colors.roxy, fontWeight: '700', fontSize: 15 },
    errorNote: {
      color: colors.error, fontSize: 12.5, textAlign: 'center',
      marginTop: 12, maxWidth: 260,
    },
  });

  const navigate = useCallback((roomUrl: string, sessionId: string) => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    router.replace({
      pathname: '/speed-dating/session',
      params: { session_id: sessionId, room_url: roomUrl },
    } as any);
  }, [router]);

  // Take a place in the queue again.
  //
  // "Keep waiting" used to increment a counter and nothing else: the screen
  // reset its own deadline while the server-side row it was waiting on could
  // already be gone, so the user read "we're still listening" forever. This is
  // the call that makes that sentence true.
  const rejoin = useCallback(async (auto: boolean) => {
    if (rejoiningRef.current || navigatedRef.current) return;
    if (auto) {
      if (autoRejoinsRef.current >= MAX_AUTO_REJOINS) {
        lostPlaceRef.current = true;
        setLostPlace(true);
        return;
      }
      autoRejoinsRef.current += 1;
    } else {
      autoRejoinsRef.current = 0;
    }

    rejoiningRef.current = true;
    setRejoining(true);

    const { data, error } = await callEdgeFunction<JoinQueueResponse>(
      'join-speed-date-session',
      communityId ? { community_id: communityId } : {},
    );

    rejoiningRef.current = false;
    setRejoining(false);

    if (error || !data?.session_id) {
      if (error) logError(new Error(error), 'speedDateWaitingRoom_rejoin');
      lostPlaceRef.current = true;
      setLostPlace(true);
      return;
    }

    lostPlaceRef.current = false;
    setLostPlace(false);
    setPollFailed(false);

    if (data.status === 'active' && data.room_url) {
      navigate(data.room_url, data.session_id);
      return;
    }

    if (data.session_id !== session_id) {
      // A different row: point this screen at it, or the subscription and the
      // heartbeat keep talking about a session that no longer concerns us.
      router.replace({
        pathname: '/speed-dating/waiting-room',
        params: {
          session_id: data.session_id,
          communityId: communityId ?? '',
          communityName: communityName ?? '',
        },
      } as any);
      return;
    }

    setTimedOut(false);
    setWaitAttempt((n) => n + 1);
  }, [communityId, communityName, navigate, router, session_id]);

  useEffect(() => { rejoinRef.current = rejoin; }, [rejoin]);

  // Animate the waiting dots
  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Realtime subscription — navigate as soon as session becomes active
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session_id) return;

    navigatedRef.current = false;

    // Subscribe to this specific session row
    const channel = supabase
      .channel(`waiting-room-${session_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'speed_date_sessions',
          filter: `id=eq.${session_id}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated.status === 'active' && updated.daily_room_url) {
            navigate(updated.daily_room_url, session_id);
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    // Heartbeat every 3 seconds. Two jobs in one round trip: it refreshes
    // last_seen_at so the reaper can tell a waiting user from an abandoned row,
    // and it reports the row's status even once that status is one the 004 read
    // policy hides -- a plain SELECT 404s the moment the row is retired, which
    // the screen could only ever read as a network wobble.
    const beat = setInterval(async () => {
      if (navigatedRef.current || lostPlaceRef.current) return;

      const { data, error } = await supabase
        .rpc('speed_date_queue_heartbeat', { p_session_id: session_id });

      if (error) { setPollFailed(true); return; }
      setPollFailed(false);

      const row = (data as QueueHeartbeatRow[] | null)?.[0] ?? null;

      // No row at all: retired and swept, or never ours. Same remedy.
      if (!row) { rejoinRef.current(true); return; }

      if (row.session_status === 'active' && row.room_url) {
        navigate(row.room_url, session_id);
        return;
      }

      if (row.session_status === 'completed') rejoinRef.current(true);
    }, HEARTBEAT_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(beat);
    };
  }, [session_id]);

  // Stop pretending someone is about to appear. The subscription and the
  // heartbeat stay alive underneath, so a late match still lands the user in
  // the call — and the heartbeat is what keeps her claimable while she reads
  // this.
  useEffect(() => {
    if (!session_id) return;
    setTimedOut(false);
    const id = setTimeout(() => setTimedOut(true), QUEUE_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [session_id, waitAttempt]);

  const handleCancel = async () => {
    const confirmed = await confirmAction('Leave queue?', 'You will be removed from the waiting list.', 'Leave');
    if (!confirmed) return;
    if (session_id && user?.id) {
      // Retire the row server-side. The previous read-modify-write left
      // status='scheduled' with an empty participant list behind on every
      // cancel; those rows piled up at the front of the matchmaking scan and
      // eventually starved it completely.
      const { error } = await supabase.rpc('leave_speed_date_queue', { p_session_id: session_id });
      if (error) logError(error, 'speedDateWaitingRoom_leaveQueue');
    }
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    router.back();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        {/* Pulsing icon */}
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>⚡</Text>
        </View>

        {lostPlace ? (
          <>
            <Text style={styles.title}>We lost your spot</Text>
            <Text style={styles.subtitle}>
              The queue let go of your place — that's on us, not you. Tap below and
              we'll put you straight back in.
            </Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => rejoinRef.current(false)}
              disabled={rejoining}
              accessibilityLabel="Rejoin the speed dating queue"
            >
              {rejoining
                ? <ActivityIndicator color={colors.roxy} />
                : <Text style={styles.retryText}>Rejoin the queue</Text>}
            </TouchableOpacity>
          </>
        ) : timedOut ? (
          <>
            <Text style={styles.title}>No one's free right now</Text>
            <Text style={styles.subtitle}>
              {communityName
                ? `Nobody in ${communityName} is queued at the moment. Try the open pool, or check back a bit later.`
                : "Nobody's in the queue this minute. It fills up fastest in the evenings."}
            </Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => rejoinRef.current(false)}
              disabled={rejoining}
              accessibilityLabel="Keep waiting for a match"
            >
              {rejoining
                ? <ActivityIndicator color={colors.roxy} />
                : <Text style={styles.retryText}>Keep waiting</Text>}
            </TouchableOpacity>
            <Text style={styles.hint}>
              We're still listening — if someone joins, your call starts automatically.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Finding your match{dots}</Text>
            <Text style={styles.subtitle}>
              {communityName
                ? `We're finding you a date inside ${communityName}. Hang tight!`
                : "We're looking for your next great five minutes. Hang tight!"}
            </Text>

            <ActivityIndicator color={colors.roxy} size="large" style={{ marginTop: 32 }} />

            <Text style={styles.hint}>
              As soon as we find a match, your video call will start automatically.
            </Text>
          </>
        )}

        {pollFailed && !lostPlace && (
          <Text style={styles.errorNote}>
            We're having trouble reaching the queue. Retrying…
          </Text>
        )}
      </View>

      <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
        <Text style={styles.cancelText}>Leave Queue</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
