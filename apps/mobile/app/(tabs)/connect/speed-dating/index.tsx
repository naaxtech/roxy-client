import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useThemeColors } from '../../../../hooks/useThemeColors';

export default function SpeedDatingLobby() {
  const router = useRouter();
  const { user } = useAuthStore();
  const colors = useThemeColors();
  const [joining, setJoining] = useState(false);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { width: 40 },
    backText: { color: colors.textPrimary, fontSize: 28, lineHeight: 30 },
    headerTitle: {
      flex: 1, color: colors.textPrimary, fontWeight: '700',
      fontSize: 17, textAlign: 'center',
    },
    body: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: 28, gap: 16,
    },
    heroIcon: { fontSize: 56, marginBottom: 4 },
    heroTitle: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', textAlign: 'center' },
    heroSubtitle: {
      color: colors.textSecondary, fontSize: 15, textAlign: 'center',
      lineHeight: 22, maxWidth: 300,
    },
    stepsCard: {
      backgroundColor: colors.surface, borderRadius: 16, padding: 16,
      width: '100%', gap: 8, marginVertical: 8,
    },
    stepsTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14, marginBottom: 4 },
    step: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    joinBtn: {
      backgroundColor: colors.primary, borderRadius: 16,
      paddingVertical: 16, paddingHorizontal: 40,
      width: '100%', alignItems: 'center',
      shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    joinBtnLoading: { opacity: 0.7 },
    joinBtnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  });

  const handleJoin = async () => {
    if (!user) return;
    setJoining(true);

    const { data, error } = await callEdgeFunction<{
      session_id: string;
      status: 'waiting' | 'active';
      room_url: string | null;
      participant_count: number;
    }>('join-speed-date-session', {});

    setJoining(false);

    if (error || !data?.session_id) {
      Alert.alert('Could not join', error ?? 'Something went wrong. Please try again.');
      return;
    }

    if (data.status === 'active' && data.room_url) {
      // Matched instantly — go straight to video
      router.push({
        pathname: '/speed-dating/session',
        params: { session_id: data.session_id, room_url: data.room_url },
      } as any);
    } else {
      // Waiting for a match — go to waiting room
      router.push({
        pathname: '/speed-dating/waiting-room',
        params: { session_id: data.session_id },
      } as any);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Speed Dating</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Body */}
      <View style={styles.body}>
        <Text style={styles.heroIcon}>⚡</Text>
        <Text style={styles.heroTitle}>Meet someone new</Text>
        <Text style={styles.heroSubtitle}>
          We'll match you with someone from your communities for a 5-minute video speed date.
        </Text>

        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>How it works</Text>
          <Text style={styles.step}>1. Tap Join — we'll find you a match</Text>
          <Text style={styles.step}>2. Wait in the queue (usually under 1 min)</Text>
          <Text style={styles.step}>3. Video call starts automatically when matched</Text>
          <Text style={styles.step}>4. Chat for 5 minutes, then decide if you like them</Text>
        </View>

        <TouchableOpacity
          style={[styles.joinBtn, joining && styles.joinBtnLoading]}
          onPress={handleJoin}
          disabled={joining}
          activeOpacity={0.85}
        >
          {joining ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.joinBtnText}>⚡ Join Speed Dating</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
