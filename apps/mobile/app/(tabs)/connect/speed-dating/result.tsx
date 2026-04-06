import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { COLORS } from '../../../../lib/constants';
import { logError } from '../../../../lib/errorLogger';
import { Analytics } from '../../../../lib/analytics';

export default function SpeedDateResult() {
  const { session_id, liked: likedParam, partner_id } = useLocalSearchParams<{
    session_id: string;
    liked: string;
    partner_id: string;
  }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const liked = likedParam === '1';
  const [processing, setProcessing] = useState(liked);
  const [matchCreated, setMatchCreated] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Analytics.speedDateCompleted();
  }, []);

  // Pulse animation for the match card
  const scaleAnim = useRef(new Animated.Value(0.6)).current;
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

  // Create match + conversation if liked
  useEffect(() => {
    if (!liked || !user || !partner_id) {
      setProcessing(false);
      return;
    }

    (async () => {
      setProcessing(true);
      try {
        // 1. Insert match row
        const { error: matchErr } = await supabase.from('matches').insert({
          user_a_id: user.id,
          user_b_id: partner_id,
          source: 'speed_date',
        });

        if (matchErr && !matchErr.message.includes('duplicate')) {
          throw new Error(matchErr.message);
        }

        // 2. Create (or reuse) a speed_date conversation for this pair
        let convId: string | null = null;
        const { data: existing } = await supabase
          .from('conversations')
          .select('id')
          .eq('conversation_type', 'speed_date')
          .contains('participant_ids', [user.id, partner_id])
          .single();

        if (existing) {
          convId = existing.id;
        } else {
          const { data: newConv, error: convErr } = await supabase
            .from('conversations')
            .insert({
              participant_ids: [user.id, partner_id],
              conversation_type: 'speed_date',
            })
            .select('id')
            .single();

          if (convErr) throw new Error(convErr.message);
          convId = newConv?.id ?? null;

          // 3. Fire roxy-icebreaker (non-blocking — ignore errors)
          if (convId) {
            callEdgeFunction('roxy-icebreaker', {
              conversation_id: convId,
              user_a_name: user.id,
              user_b_name: partner_id,
              shared_interests: [],
            }).catch(() => {});
          }
        }

        setConversationId(convId);
        setMatchCreated(true);
      } catch (e: any) {
        logError(e, 'speedDateResult_createMatch');
        setError(e?.message ?? 'Something went wrong.');
      } finally {
        setProcessing(false);
      }
    })();
  }, [liked, user, partner_id]);

  const handleChat = () => {
    if (conversationId) {
      router.replace(`/chat/${conversationId}` as any);
    }
  };

  const handleExplore = () => {
    router.replace('/speed-dating' as any);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {processing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.roxy} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  processingText: { color: COLORS.textSecondary, fontSize: 15, marginTop: 12 },

  // Match
  matchCard: {
    backgroundColor: COLORS.surface, borderRadius: 24, padding: 28,
    alignItems: 'center', gap: 12, width: '100%',
    borderWidth: 1, borderColor: COLORS.primary + '50',
  },
  matchEmoji: { fontSize: 52 },
  matchTitle: { color: COLORS.textPrimary, fontSize: 24, fontWeight: '800' },
  matchSubtitle: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  chatBtn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingHorizontal: 28, paddingVertical: 14, marginTop: 8, width: '100%', alignItems: 'center',
  },
  chatBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  laterBtn: { paddingVertical: 8 },
  laterBtnText: { color: COLORS.textMuted, fontSize: 14 },

  // No match / error
  noMatchEmoji: { fontSize: 52 },
  noMatchTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  noMatchSubtitle: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  exploreBtn: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 28, paddingVertical: 14, marginTop: 8,
    borderWidth: 1, borderColor: COLORS.primary + '50',
  },
  exploreBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  errorEmoji: { fontSize: 48 },
  errorTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  errorMsg: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center' },
});
