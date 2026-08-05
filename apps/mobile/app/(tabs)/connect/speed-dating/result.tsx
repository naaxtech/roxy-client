import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { logError } from '../../../../lib/errorLogger';
import { Analytics } from '../../../../lib/analytics';

interface ResolveResult {
  status: 'waiting' | 'matched' | 'no_match';
  conversation_id: string | null;
}

const PARTNER_RECHECK_MS = 5_000;
// Stop re-checking after two minutes. By then the partner has closed the app
// and the notification path, not this screen, is the right way to tell them.
const PARTNER_RECHECK_GIVE_UP_MS = 120_000;

export default function SpeedDateResult() {
  const { session_id, liked: likedParam, partner_id } = useLocalSearchParams<{
    session_id: string;
    liked: string;
    partner_id: string;
  }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const colors = useThemeColors();

  const liked = likedParam === '1';
  const [processing, setProcessing] = useState(true);
  const [matchCreated, setMatchCreated] = useState(false);
  const [waitingOnPartner, setWaitingOnPartner] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Analytics.speedDateCompleted();
  }, []);

  // Pulse animation for the match card
  const scaleAnim = useRef(new Animated.Value(0.6)).current;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (matchCreated) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 60,
        friction: 7,
        useNativeDriver: true,
      }).start();
    }
  }, [matchCreated]);

  const userId = user?.id ?? null;
  const icebreakerFired = useRef(false);

  // Submit this participant's like decision and resolve the match — a match
  // only forms when BOTH sides have said yes (submit_speed_date_like,
  // 068_speed_date_mutual_match.sql). We submit even a "no" so the other
  // participant's side isn't left waiting forever. Idempotent: the RPC upserts
  // our row, so calling it again just re-reads the current verdict.
  const resolveMatch = useCallback(async (): Promise<void> => {
    if (!userId || !partner_id || !session_id) return;

    const { data, error: rpcErr } = await supabase
      .rpc('submit_speed_date_like', { p_session_id: session_id, p_liked: liked });
    if (rpcErr) throw new Error(rpcErr.message);

    const result = data as ResolveResult;

    if (result.status === 'matched' && result.conversation_id) {
      setWaitingOnPartner(false);
      setConversationId(result.conversation_id);
      setMatchCreated(true);
      if (!icebreakerFired.current) {
        icebreakerFired.current = true;
        callEdgeFunction('roxy-icebreaker', {
          conversation_id: result.conversation_id,
          user_a_name: userId,
          user_b_name: partner_id,
          shared_interests: [],
        }).catch(() => {});
      }
    } else if (result.status === 'waiting') {
      setWaitingOnPartner(true);
    } else {
      // 'no_match' — falls through to the default no-match UI state.
      setWaitingOnPartner(false);
    }
  }, [userId, partner_id, session_id, liked]);

  useEffect(() => {
    if (!userId || !partner_id || !session_id) {
      setProcessing(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setProcessing(true);
      try {
        await resolveMatch();
      } catch (e) {
        if (cancelled) return;
        logError(e, 'speedDateResult_resolveMatch');
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      } finally {
        if (!cancelled) setProcessing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, partner_id, session_id, resolveMatch]);

  // While waiting on the partner's decision, listen for their row landing.
  useEffect(() => {
    if (!waitingOnPartner || !userId || !partner_id || !session_id) return;

    const channel = supabase
      .channel(`speed-date-likes:${session_id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'speed_date_likes', filter: `session_id=eq.${session_id}` },
        (payload) => {
          if ((payload.new as { user_id?: string } | null)?.user_id === userId) return; // our own row
          resolveMatch().catch((e) => logError(e, 'speedDateResult_partnerLikeReceived'));
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [waitingOnPartner, userId, partner_id, session_id, resolveMatch]);

  // Fallback re-check. The subscription above is only created once the RPC has
  // already answered 'waiting', so a partner decision landing inside that
  // window fires before the channel exists and is lost. Without this the user
  // sits on "waiting to see if it's mutual" forever and never learns they
  // matched.
  useEffect(() => {
    if (!waitingOnPartner || !userId || !partner_id || !session_id) return;

    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += PARTNER_RECHECK_MS;
      if (elapsed >= PARTNER_RECHECK_GIVE_UP_MS) {
        clearInterval(id);
        return;
      }
      resolveMatch().catch((e) => logError(e, 'speedDateResult_recheck'));
    }, PARTNER_RECHECK_MS);

    return () => clearInterval(id);
  }, [waitingOnPartner, userId, partner_id, session_id, resolveMatch]);

  const handleChat = () => {
    if (conversationId) {
      router.replace(`/chat/${conversationId}` as any);
    }
  };

  const handleExplore = () => {
    router.replace('/speed-dating' as any);
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
    processingText: { color: colors.textSecondary, fontSize: 15, marginTop: 12 },

    // Match
    matchCard: {
      backgroundColor: colors.surface, borderRadius: 24, padding: 28,
      alignItems: 'center', gap: 12, width: '100%',
      borderWidth: 1, borderColor: colors.primary + '50',
    },
    matchEmoji: { fontSize: 52 },
    matchTitle: { color: colors.textPrimary, fontSize: 24, fontWeight: '800' },
    matchSubtitle: { color: colors.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 22 },
    chatBtn: {
      backgroundColor: colors.primary, borderRadius: 12,
      paddingHorizontal: 28, paddingVertical: 14, marginTop: 8, width: '100%', alignItems: 'center',
    },
    chatBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    laterBtn: { paddingVertical: 8 },
    laterBtnText: { color: colors.textMuted, fontSize: 14 },

    // No match / error
    noMatchEmoji: { fontSize: 52 },
    noMatchTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', textAlign: 'center' },
    noMatchSubtitle: { color: colors.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 22 },
    exploreBtn: {
      backgroundColor: colors.surface, borderRadius: 12,
      paddingHorizontal: 28, paddingVertical: 14, marginTop: 8,
      borderWidth: 1, borderColor: colors.primary + '50',
    },
    exploreBtnText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
    errorEmoji: { fontSize: 48 },
    errorTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
    errorMsg: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {processing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.roxy} />
          <Text style={styles.processingText}>Creating your connection…</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorEmoji}>😔</Text>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorMsg}>{error}</Text>
          <TouchableOpacity style={styles.exploreBtn} onPress={handleExplore}>
            <Text style={styles.exploreBtnText}>Back to lobby</Text>
          </TouchableOpacity>
        </View>
      ) : matchCreated ? (
        <View style={styles.centered}>
          <Animated.View style={[styles.matchCard, { transform: [{ scale: scaleAnim }] }]}>
            <Text style={styles.matchEmoji}>💜</Text>
            <Text style={styles.matchTitle}>It's a match!</Text>
            <Text style={styles.matchSubtitle}>
              You both felt the connection. Roxy has sent you an icebreaker to get started.
            </Text>
            <TouchableOpacity style={styles.chatBtn} onPress={handleChat}>
              <Text style={styles.chatBtnText}>Start chatting →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.laterBtn} onPress={handleExplore}>
              <Text style={styles.laterBtnText}>Later</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      ) : waitingOnPartner ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.roxy} />
          <Text style={styles.processingText}>
            Waiting to see if it's mutual — we'll let you know either way.
          </Text>
          <TouchableOpacity style={styles.laterBtn} onPress={handleExplore}>
            <Text style={styles.laterBtnText}>Keep exploring meanwhile</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.centered}>
          <Text style={styles.noMatchEmoji}>✨</Text>
          <Text style={styles.noMatchTitle}>
            {liked ? 'No mutual match yet' : 'Session complete!'}
          </Text>
          <Text style={styles.noMatchSubtitle}>
            {liked
              ? "You liked them — but it doesn't look mutual this time. Keep exploring!"
              : "Thanks for speed dating. Keep exploring to find your people."}
          </Text>
          <TouchableOpacity style={styles.exploreBtn} onPress={handleExplore}>
            <Text style={styles.exploreBtnText}>Keep exploring</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}
