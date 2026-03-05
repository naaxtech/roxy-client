import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, PanResponder, Alert, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { isDailyAvailable } from '../../../../lib/daily';
import { COLORS } from '../../../../lib/constants';
import { SpeedDateSession } from '../../../../types';

// Guarded Daily.co import
let DailyCall: any = null;
let DailyMediaView: any = null;
try {
  const mod = require('@daily-co/react-native-daily-js');
  DailyCall = mod.default ?? mod;
  DailyMediaView = mod.DailyMediaView ?? null;
} catch {}

const TIMER_COLORS = { green: '#10B981', yellow: '#F59E0B', red: '#EF4444' };

function TimerBar({ elapsed, total }: { elapsed: number; total: number }) {
  const progress = Math.min(elapsed / total, 1);
  const remaining = total - elapsed;
  const color =
    progress < 0.6 ? TIMER_COLORS.green :
    progress < 0.85 ? TIMER_COLORS.yellow :
    TIMER_COLORS.red;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <View style={timerStyles.container}>
      <View style={timerStyles.track}>
        <View style={[timerStyles.fill, { width: `${(1 - progress) * 100}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[timerStyles.label, { color }]}>
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </Text>
    </View>
  );
}

const timerStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  track: { flex: 1, height: 6, backgroundColor: COLORS.surface, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  label: { fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'], minWidth: 44 },
});

function VideoPlaceholder({ label }: { label: string }) {
  return (
    <View style={vidStyles.placeholder}>
      <Text style={vidStyles.icon}>👤</Text>
      <Text style={vidStyles.label}>{label}</Text>
    </View>
  );
}

const vidStyles = StyleSheet.create({
  placeholder: { flex: 1, backgroundColor: '#0d0520', alignItems: 'center', justifyContent: 'center', gap: 8 },
  icon: { fontSize: 48 },
  label: { color: COLORS.textMuted, fontSize: 14 },
});

export default function SpeedDateSession() {
  const { session_id, room_url } = useLocalSearchParams<{ session_id: string; room_url: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [session, setSession] = useState<SpeedDateSession | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [promptIndex, setPromptIndex] = useState(0);
  const [liked, setLiked] = useState(false);
  const [callObject, setCallObject] = useState<any>(null);
  const [remoteSessionId, setRemoteSessionId] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasEnded = useRef(false);

  // Draggable overlay position
  const overlayPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        overlayPos.setOffset({ x: (overlayPos.x as any)._value, y: (overlayPos.y as any)._value });
        overlayPos.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: overlayPos.x, dy: overlayPos.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => overlayPos.flattenOffset(),
    })
  ).current;

  // Load session (prompts)
  useEffect(() => {
    if (!session_id) return;
    supabase
      .from('speed_date_sessions')
      .select('*')
      .eq('id', session_id)
      .single()
      .then(({ data }) => {
        if (data) setSession(data as SpeedDateSession);
      });
  }, [session_id]);

  // Start timer when session loads
  useEffect(() => {
    if (!session) return;
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= session.duration_seconds && !hasEnded.current) {
          hasEnded.current = true;
          handleEnd();
        }
        return next;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [session]);

  // Daily.co call setup
  useEffect(() => {
    if (!isDailyAvailable() || !room_url || !DailyCall) return;
    let call: any = null;
    try {
      call = DailyCall.createCallObject();
      call.join({ url: room_url });

      call.on('participant-joined', (evt: any) => {
        if (!evt.participant.local) {
          setRemoteSessionId(evt.participant.session_id);
        }
      });
      call.on('participant-left', () => setRemoteSessionId(null));

      setCallObject(call);
    } catch (e) {
      console.warn('[SpeedDate] Daily.co join failed:', e);
    }

    return () => {
      if (call) {
        call.leave().catch(() => {});
        call.destroy().catch(() => {});
      }
    };
  }, [room_url]);

  const handleEnd = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    // Determine partner_id from session participant_ids
    const partnerId = session?.participant_ids.find((id) => id !== user?.id) ?? null;

    // Leave Daily call
    if (callObject) {
      callObject.leave().catch(() => {});
    }

    router.replace({
      pathname: '/(tabs)/connect/speed-dating/result',
      params: {
        session_id: session_id ?? '',
        liked: liked ? '1' : '0',
        partner_id: partnerId ?? '',
      },
    });
  }, [session, liked, callObject, session_id, router, user]);

  const handleLeave = () => {
    Alert.alert('Leave session?', 'Are you sure you want to leave early?', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: handleEnd },
    ]);
  };

  const duration = session?.duration_seconds ?? 300;
  const prompts = session?.prompts ?? [];
  const currentPrompt = prompts[promptIndex] ?? '✨ Get to know each other!';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Timer bar */}
      <SafeAreaView edges={['top']} style={styles.topSafe}>
        <View style={styles.topBar}>
          <TimerBar elapsed={elapsed} total={duration} />
          <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave}>
            <Text style={styles.leaveBtnText}>Leave</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Remote video (full screen behind overlay) */}
      <View style={styles.remoteVideo}>
        {isDailyAvailable() && DailyMediaView && remoteSessionId ? (
          <DailyMediaView
            sessionId={remoteSessionId}
            videoTrackState={callObject?.participants()?.[remoteSessionId]?.videoTrack ?? null}
            audioTrackState={callObject?.participants()?.[remoteSessionId]?.audioTrack ?? null}
            style={StyleSheet.absoluteFill}
            mirror={false}
          />
        ) : (
          <VideoPlaceholder label="Waiting for match…" />
        )}
      </View>

      {/* Draggable Roxy prompt overlay */}
      <Animated.View
        style={[styles.promptOverlay, { transform: overlayPos.getTranslateTransform() }]}
        {...panResponder.panHandlers}
      >
        <Text style={styles.promptLabel}>✨ Roxy prompt</Text>
        <Text style={styles.promptText}>{currentPrompt}</Text>
        {prompts.length > 1 && (
          <TouchableOpacity
            style={styles.nextPromptBtn}
            onPress={() => setPromptIndex((i) => (i + 1) % prompts.length)}
          >
            <Text style={styles.nextPromptText}>Next →</Text>
          </TouchableOpacity>
        )}
      </Animated.View>

      {/* Self-view PiP */}
      <View style={styles.selfPip}>
        {isDailyAvailable() && DailyMediaView && callObject ? (
          <DailyMediaView
            sessionId="local"
            videoTrackState={callObject?.participants()?.local?.videoTrack ?? null}
            audioTrackState={null}
            style={StyleSheet.absoluteFill}
            mirror={true}
          />
        ) : (
          <VideoPlaceholder label="You" />
        )}
      </View>

      {/* Bottom controls */}
      <SafeAreaView edges={['bottom']} style={styles.bottomSafe}>
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.likeBtn, liked && styles.likeBtnActive]}
            onPress={() => setLiked((v) => !v)}
          >
            <Text style={styles.likeIcon}>{liked ? '❤️' : '🤍'}</Text>
            <Text style={[styles.likeText, liked && styles.likeTextActive]}>
              {liked ? 'Liked!' : 'Like'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topSafe: { zIndex: 10 },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', paddingRight: 8,
  },
  leaveBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: COLORS.error + '30', borderRadius: 8,
  },
  leaveBtnText: { color: COLORS.error, fontWeight: '700', fontSize: 13 },
  remoteVideo: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  promptOverlay: {
    position: 'absolute',
    top: '35%', left: '5%', right: '5%',
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: COLORS.roxy + '60',
    zIndex: 20,
  },
  promptLabel: { color: COLORS.roxy, fontSize: 11, fontWeight: '700', marginBottom: 6 },
  promptText: { color: '#fff', fontSize: 16, lineHeight: 22, fontStyle: 'italic' },
  nextPromptBtn: {
    alignSelf: 'flex-end', marginTop: 10,
    backgroundColor: COLORS.roxy + '30', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  nextPromptText: { color: COLORS.roxy, fontWeight: '700', fontSize: 13 },
  selfPip: {
    position: 'absolute', bottom: 80, right: 16,
    width: 90, height: 130, borderRadius: 12,
    overflow: 'hidden', backgroundColor: COLORS.surface,
    borderWidth: 2, borderColor: COLORS.primary,
    zIndex: 15,
  },
  bottomSafe: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 },
  bottomBar: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 12, backgroundColor: 'rgba(0,0,0,0.7)',
  },
  likeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 28, paddingVertical: 12,
    backgroundColor: COLORS.surface, borderRadius: 30,
    borderWidth: 2, borderColor: COLORS.surface,
  },
  likeBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '20' },
  likeIcon: { fontSize: 22 },
  likeText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: 16 },
  likeTextActive: { color: COLORS.primary },
});
