import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { callEdgeFunction, supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { showAlert } from '../../lib/confirm';

export default function SpeedDatingLobby() {
  const router = useRouter();
  const { communityId } = useLocalSearchParams<{ communityId?: string }>();
  const { user } = useAuthStore();
  const colors = useThemeColors();
  const [joining, setJoining] = useState(false);
  const [communityName, setCommunityName] = useState<string | null>(null);

  useEffect(() => {
    if (!communityId) { setCommunityName(null); return; }
    void supabase
      .from('communities')
      .select('name')
      .eq('id', communityId)
      .maybeSingle()
      .then(({ data }) => setCommunityName(data?.name ?? null));
  }, [communityId]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 12,
    },
    backBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    headerTitle: {
      flex: 1, color: colors.textPrimary, fontWeight: '800',
      fontSize: 17, textAlign: 'center',
    },
    body: { flex: 1, paddingHorizontal: 20, gap: 14, justifyContent: 'center' },
    hero: {
      borderRadius: 24, padding: 22, alignItems: 'center', gap: 8,
      shadowColor: '#E81C8E', shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35, shadowRadius: 16, elevation: 8,
    },
    heroIconPlate: {
      width: 64, height: 64, borderRadius: 32,
      backgroundColor: '#fff',
      alignItems: 'center', justifyContent: 'center',
      marginBottom: 4,
    },
    heroTitle: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center' },
    heroSubtitle: {
      color: 'rgba(255,255,255,0.92)', fontSize: 14.5, textAlign: 'center',
      lineHeight: 21, maxWidth: 300, fontWeight: '600',
    },
    scopeChip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: 'rgba(255,255,255,0.22)',
      borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5,
      marginTop: 4,
    },
    scopeChipText: { color: '#fff', fontSize: 12, fontWeight: '800' },
    stepsCard: {
      backgroundColor: colors.surface, borderRadius: 18, padding: 16, gap: 10,
    },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepNum: {
      width: 24, height: 24, borderRadius: 12,
      backgroundColor: colors.roxy + '22',
      alignItems: 'center', justifyContent: 'center',
    },
    stepNumText: { color: colors.roxy, fontWeight: '800', fontSize: 12 },
    step: { color: colors.textSecondary, fontSize: 13.5, lineHeight: 18, flex: 1 },
    joinBtnWrap: { borderRadius: 18, overflow: 'hidden' },
    joinBtn: {
      minHeight: 54, alignItems: 'center', justifyContent: 'center',
      flexDirection: 'row', gap: 8,
    },
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
    }>('join-speed-date-session', communityId ? { community_id: communityId } : {});

    setJoining(false);

    if (error || !data?.session_id) {
      showAlert('Could not join', error ?? 'Something went wrong. Please try again.');
      return;
    }

    if (data.status === 'active' && data.room_url) {
      // Matched instantly — go straight to video
      router.push({
        pathname: '/speed-dating/session',
        params: { session_id: data.session_id, room_url: data.room_url },
      } as any);
    } else {
      // Waiting for a match — go to waiting room. communityId travels with it:
      // if the queue ever drops her place, the waiting room has to rejoin the
      // same pool she chose, not the open one.
      router.push({
        pathname: '/speed-dating/waiting-room',
        params: {
          session_id: data.session_id,
          communityId: communityId ?? '',
          communityName: communityName ?? '',
        },
      } as any);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Speed Dating</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Body */}
      <View style={styles.body}>
        <LinearGradient
          colors={['#FF6A2E', '#FF2F71', '#E81C8E']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroIconPlate}>
            <Ionicons name="flash" size={30} color="#FF2F71" />
          </View>
          <Text style={styles.heroTitle}>Meet someone new</Text>
          <Text style={styles.heroSubtitle}>
            Five minutes on video. Real sparks, zero pressure.
          </Text>
          <View style={styles.scopeChip}>
            <Ionicons name={communityName ? 'people' : 'flash'} size={12} color="#fff" />
            <Text style={styles.scopeChipText}>
              {communityName ? `Matching within ${communityName}` : 'Feeling wild — open matching'}
            </Text>
          </View>
        </LinearGradient>

        <View style={styles.stepsCard}>
          {[
            "Tap Join — we'll find your match",
            'Wait in the queue (usually under a minute)',
            'Your video date starts automatically',
            'Chat for 5 minutes, then choose 🌸 or pass',
          ].map((text, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
              <Text style={styles.step}>{text}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.joinBtnWrap}
          onPress={handleJoin}
          disabled={joining}
          activeOpacity={0.85}
          accessibilityLabel="Join speed dating"
        >
          <LinearGradient
            colors={['#FF6A2E', '#FF2F71', '#E81C8E']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.joinBtn, joining && { opacity: 0.7 }]}
          >
            {joining ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="flash" size={18} color="#fff" />
                <Text style={styles.joinBtnText}>Join Speed Dating</Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
