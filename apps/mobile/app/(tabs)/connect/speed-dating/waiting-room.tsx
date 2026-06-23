import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useThemeColors } from '../../../../hooks/useThemeColors';

export default function SpeedDateWaitingRoom() {
  const { session_id } = useLocalSearchParams<{ session_id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const colors = useThemeColors();
  const [dots, setDots] = useState('');
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const navigatedRef = useRef(false);

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
  });

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

    const navigate = (roomUrl: string) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      router.replace({
        pathname: '/speed-dating/session',
        params: { session_id, room_url: roomUrl },
      } as any);
    };

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
            navigate(updated.daily_room_url);
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    // Polling fallback every 3 seconds
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('speed_date_sessions')
        .select('status, daily_room_url')
        .eq('id', session_id)
        .single();
      if (data?.status === 'active' && data?.daily_room_url) {
        navigate(data.daily_room_url);
      }
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [session_id]);

  const handleCancel = () => {
    Alert.alert('Leave queue?', 'You will be removed from the waiting list.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          if (session_id && user?.id) {
            // Remove self from participant_ids
            const { data: session } = await supabase
              .from('speed_date_sessions')
              .select('participant_ids')
              .eq('id', session_id)
              .single();
            if (session) {
              const remaining = (session.participant_ids as string[]).filter((id) => id !== user.id);
              await supabase
                .from('speed_date_sessions')
                .update({ participant_ids: remaining })
                .eq('id', session_id);
            }
          }
          if (channelRef.current) supabase.removeChannel(channelRef.current);
          router.back();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        {/* Pulsing icon */}
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>⚡</Text>
        </View>

        <Text style={styles.title}>Finding your match{dots}</Text>
        <Text style={styles.subtitle}>
          We're looking for someone in your communities to speed date with. Hang tight!
        </Text>

        <ActivityIndicator color={colors.roxy} size="large" style={{ marginTop: 32 }} />

        <Text style={styles.hint}>
          As soon as we find a match, your video call will start automatically.
        </Text>
      </View>

      <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
        <Text style={styles.cancelText}>Leave Queue</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
