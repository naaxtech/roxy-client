import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format, differenceInMilliseconds, isPast, isWithinInterval, addMinutes } from 'date-fns';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { COLORS } from '../../../../lib/constants';
import { SpeedDateSession } from '../../../../types';

const JOIN_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

function useCountdown(tick: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tick);
    return () => clearInterval(id);
  }, [tick]);
  return now;
}

function SessionCard({
  session,
  now,
  onJoin,
  joining,
}: {
  session: SpeedDateSession;
  now: number;
  onJoin: (id: string) => void;
  joining: string | null;
}) {
  const scheduled = new Date(session.scheduled_at);
  const msUntil = differenceInMilliseconds(scheduled, now);
  const isActive = session.status === 'active';
  const canJoin = isActive || (msUntil <= JOIN_WINDOW_MS && msUntil > -60_000);
  const isLoading = joining === session.id;

  const countdownText = () => {
    if (isActive) return 'Live now';
    if (msUntil <= 0) return 'Starting soon';
    const totalSec = Math.floor(msUntil / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const participantText = `${session.participant_ids.length}/2 joined`;

  return (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <View style={[styles.statusBadge, isActive ? styles.statusActive : styles.statusScheduled]}>
          <Text style={styles.statusText}>{isActive ? '● Live' : '○ Upcoming'}</Text>
        </View>
        <Text style={styles.cardTime}>{format(scheduled, 'EEE, MMM d · HH:mm')}</Text>
        <Text style={styles.cardDuration}>{Math.floor(session.duration_seconds / 60)} min speed date</Text>
        <Text style={styles.cardParticipants}>{participantText}</Text>
      </View>

      <View style={styles.cardRight}>
        {!isActive && (
          <Text style={[styles.countdown, msUntil <= JOIN_WINDOW_MS && styles.countdownReady]}>
            {countdownText()}
          </Text>
        )}
        <TouchableOpacity
          style={[styles.joinBtn, !canJoin && styles.joinBtnDisabled]}
          onPress={() => canJoin && onJoin(session.id)}
          disabled={!canJoin || !!joining}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.joinBtnText}>{canJoin ? 'Join' : 'Soon'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function SpeedDatingLobby() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [sessions, setSessions] = useState<SpeedDateSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const now = useCountdown(1000);

  const loadSessions = useCallback(async () => {
    const { data, error } = await supabase
      .from('speed_date_sessions')
      .select('*')
      .in('status', ['scheduled', 'active'])
      .order('scheduled_at', { ascending: true })
      .limit(20);

    if (error) {
      Alert.alert('Error', 'Could not load sessions.');
      return;
    }
    setSessions((data as SpeedDateSession[]) ?? []);
  }, []);

  useEffect(() => {
    loadSessions().finally(() => setLoading(false));
  }, [loadSessions]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  }, [loadSessions]);

  const handleHost = async () => {
    if (!user) return;
    const scheduledAt = new Date(Date.now() + 60 * 1000); // 1 minute from now
    const { data, error } = await supabase
      .from('speed_date_sessions')
      .insert({
        scheduled_at: scheduledAt.toISOString(),
        duration_seconds: 300,
        participant_ids: [],
        status: 'scheduled',
        prompts: [],
      })
      .select('id')
      .single();

    if (error || !data?.id) {
      Alert.alert('Error', 'Could not create session.');
      return;
    }
    await loadSessions();
  };

  const handleJoin = async (sessionId: string) => {
    if (!user) return;
    setJoining(sessionId);

    const { data, error } = await callEdgeFunction<{
      room_url: string;
      session_id: string;
      status: string;
      participant_count: number;
    }>('join-speed-date-session', { session_id: sessionId });

    setJoining(null);

    if (error || !data?.room_url) {
      Alert.alert('Could not join', error ?? 'No room URL returned.');
      return;
    }

    router.push({
      pathname: '/speed-dating/session',
      params: {
        session_id: data.session_id,
        room_url: data.room_url,
      },
    } as any);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Speed Dating</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Info banner */}
      <View style={styles.infoBanner}>
        <Text style={styles.infoBannerText}>
          💜 Match in 5 minutes. Join up to 2 min early.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.roxy} style={{ flex: 1 }} />
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SessionCard
              session={item}
              now={now}
              onJoin={handleJoin}
              joining={joining}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.roxy}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No sessions scheduled</Text>
              <Text style={styles.emptySubtitle}>
                Be the first — host a session and wait for someone to join.
              </Text>
              <TouchableOpacity style={styles.hostBtn} onPress={handleHost}>
                <Text style={styles.hostBtnText}>⚡ Host a Speed Date</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { width: 40 },
  backText: { color: COLORS.textPrimary, fontSize: 28, lineHeight: 30 },
  headerTitle: { flex: 1, color: COLORS.textPrimary, fontWeight: '700', fontSize: 17, textAlign: 'center' },
  infoBanner: {
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.primary + '30',
  },
  infoBannerText: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center' },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center',
  },
  cardLeft: { flex: 1, gap: 4 },
  cardRight: { alignItems: 'flex-end', gap: 8, marginLeft: 12 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  statusActive: { backgroundColor: COLORS.success + '30' },
  statusScheduled: { backgroundColor: COLORS.textMuted + '30' },
  statusText: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary },
  cardTime: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
  cardDuration: { color: COLORS.textSecondary, fontSize: 13 },
  cardParticipants: { color: COLORS.textMuted, fontSize: 12 },
  countdown: { color: COLORS.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  countdownReady: { color: COLORS.success, fontWeight: '700' },
  joinBtn: {
    backgroundColor: COLORS.primary, borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 10, minWidth: 64, alignItems: 'center',
  },
  joinBtnDisabled: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.textMuted + '50' },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  emptySubtitle: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  hostBtn: {
    marginTop: 8, backgroundColor: COLORS.primary, borderRadius: 12,
    paddingHorizontal: 28, paddingVertical: 14,
  },
  hostBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
