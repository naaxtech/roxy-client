import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, PanResponder, StatusBar, AppState, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useSafetyStore } from '../../store/safetyStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { logError } from '../../lib/errorLogger';
import { confirmAction, showAlert } from '../../lib/confirm';
import { Analytics } from '../../lib/analytics';
import { ConsentStrip } from '../../components/rooms/ConsentStrip';
import { TYPE } from '../../lib/typography';
import { RADII, THEMES, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import type { SpeedDateSession as SpeedDateSessionData } from '../../types';

import { DailyProvider } from '../../lib/video';
import { useVideoCall } from '../../hooks/useVideoCall';
import { a11yState } from '../../lib/a11yState';

const TIMER_COLORS = { green: '#10B981', yellow: '#F59E0B', red: '#EF4444' };

function TimerBar({ elapsed, total }: { elapsed: number; total: number }) {
  const colors = useThemeColors();
  const progress = Math.min(elapsed / total, 1);
  const remaining = total - elapsed;
  const color =
    progress < 0.6 ? TIMER_COLORS.green :
    progress < 0.85 ? TIMER_COLORS.yellow :
    TIMER_COLORS.red;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  const timerStyles = StyleSheet.create({
    container: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
    track: { flex: 1, height: 6, backgroundColor: colors.surface, borderRadius: 3, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 3 },
    label: { fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'], minWidth: 44 },
  });

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

function VideoPlaceholder({ label }: { label: string }) {
  const colors = useThemeColors();
  const vidStyles = StyleSheet.create({
    placeholder: { flex: 1, backgroundColor: '#0d0520', alignItems: 'center', justifyContent: 'center', gap: 8 },
    icon: { fontSize: 48 },
    label: { color: colors.textMuted, fontSize: 14 },
  });

  return (
    <View style={vidStyles.placeholder}>
      <Text style={vidStyles.icon}>👤</Text>
      <Text style={vidStyles.label}>{label}</Text>
    </View>
  );
}

export default function SpeedDateSession() {
  const { session_id, room_url } = useLocalSearchParams<{ session_id: string; room_url: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const colors = useThemeColors();

  const [session, setSession] = useState<SpeedDateSessionData | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [promptIndex, setPromptIndex] = useState(0);
  const [liked, setLiked] = useState(false);
  const [partnerLeft, setPartnerLeft] = useState(false);
  const [provider] = useState(() => new DailyProvider());
  const { state: _callState, remoteParticipant } = useVideoCall(provider);
  // Expo Go and the web bundle resolve @daily-co/react-native-daily-js to
  // nothing, so join() is impossible there. Read it once: the value is fixed
  // for the lifetime of the bundle.
  const [videoAvailable] = useState(() => provider.isAvailable);

  const openReportModal = useSafetyStore((st) => st.openReportModal);
  const blockUser = useSafetyStore((st) => st.blockUser);

  const [passed, setPassed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasEnded = useRef(false);
  const likedRef = useRef(false);
  const partnerHasJoined = useRef(false);

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

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    topSafe: { zIndex: 10 },
    topBar: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)', paddingRight: 8,
    },
    leaveBtn: {
      paddingHorizontal: 12, paddingVertical: 6,
      backgroundColor: colors.error + '30', borderRadius: 8,
    },
    leaveBtnText: { color: colors.error, fontWeight: '700', fontSize: 13 },
    remoteVideo: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
    promptOverlay: {
      position: 'absolute',
      top: '35%', left: '5%', right: '5%',
      backgroundColor: 'rgba(0,0,0,0.65)',
      borderRadius: 16, padding: 16,
      borderWidth: 1, borderColor: colors.roxy + '60',
      zIndex: 20,
    },
    promptLabel: { color: colors.roxy, fontSize: 11, fontWeight: '700', marginBottom: 6 },
    promptText: { color: '#fff', fontSize: 16, lineHeight: 22, fontStyle: 'italic' },
    nextPromptBtn: {
      alignSelf: 'flex-end', marginTop: 10,
      backgroundColor: colors.roxy + '30', borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 5,
    },
    nextPromptText: { color: colors.roxy, fontWeight: '700', fontSize: 13 },
    selfPip: {
      position: 'absolute', bottom: 80, right: 16,
      width: 90, height: 130, borderRadius: 12,
      overflow: 'hidden', backgroundColor: colors.surface,
      borderWidth: 2, borderColor: colors.primary,
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
      backgroundColor: colors.surface, borderRadius: 30,
      borderWidth: 2, borderColor: colors.surface,
    },
    likeBtnActive: { borderColor: colors.primary, backgroundColor: colors.primary + '20' },
    likeIcon: { fontSize: 22 },
    likeText: { color: colors.textSecondary, fontWeight: '700', fontSize: 16 },
    likeTextActive: { color: colors.primary },

    // Flower-or-pass. Sits above the consent strip, which is pinned to the
    // bottom — hence the generous bottom offset rather than a SafeAreaView.
    choiceBar: {
      position: 'absolute', left: 14, right: 14, bottom: 108,
      flexDirection: 'row', gap: 10, zIndex: 20,
    },
    pass: {
      flex: 1, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
      borderRadius: RADII.lg,
      backgroundColor: 'rgba(13,5,32,0.45)',
      borderWidth: 1, borderColor: 'rgba(255,249,251,0.35)',
    },
    passActive: { borderColor: THEMES.dark.textPrimary },
    passText: { ...TYPE.bodyLg, color: THEMES.dark.textPrimary, fontWeight: '700' },
    flower: {
      flex: 1.4, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
      borderRadius: RADII.lg, backgroundColor: colors.primary,
    },
    flowerActive: { backgroundColor: colors.success },
    flowerText: { ...TYPE.bodyLg, color: inkOn(colors.primary), fontWeight: '800' },
    consentFoot: {
      position: 'absolute', left: 0, right: 0, bottom: 86,
      textAlign: 'center', zIndex: 20,
      ...TYPE.micro, color: 'rgba(255,249,251,0.55)',
    },
    partnerLeftOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.82)',
      alignItems: 'center', justifyContent: 'center', gap: 12,
      zIndex: 30,
    },
    partnerLeftEmoji: { fontSize: 52 },
    partnerLeftTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
    partnerLeftSub: { color: colors.textMuted, fontSize: 15 },
    unavailableWrap: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: 32, gap: 12,
    },
    unavailableEmoji: { fontSize: 52 },
    unavailableTitle: {
      color: '#fff', fontSize: 21, fontWeight: '800', textAlign: 'center',
    },
    unavailableBody: {
      color: colors.textMuted, fontSize: 15, textAlign: 'center', lineHeight: 22,
    },
    unavailableBtn: {
      marginTop: 8, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28,
      backgroundColor: colors.primary,
    },
    unavailableBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  });

  // Load session (prompts)
  useEffect(() => {
    if (!session_id) return;
    void Promise.resolve(
      supabase.from('speed_date_sessions').select('*').eq('id', session_id).single()
    ).then(({ data }) => {
      if (data) setSession(data as SpeedDateSessionData);
    }).catch(() => {});
  }, [session_id]);

  // Round clock. Anchored to the server's started_at rather than counted in
  // local ticks: React Native suspends JS timers while the app is backgrounded,
  // and each handset mounts at a different instant, so a tick counter let the
  // two sides of the same date disagree about when it ended — and a user who
  // backgrounded the app came back to a date that had not moved.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session || !videoAvailable) return;

    const parsed = session.started_at ? Date.parse(session.started_at) : NaN;
    // Sessions created before migration 077 have no started_at; fall back to
    // this client's mount so an old row still gets a bounded date.
    const baseMs = Number.isFinite(parsed) ? parsed : Date.now();

    const tick = () => {
      const next = Math.max(0, Math.floor((Date.now() - baseMs) / 1000));
      setElapsed(next);
      if (next >= session.duration_seconds && !hasEnded.current) {
        hasEnded.current = true;
        handleEnd();
      }
    };

    tick();
    timerRef.current = setInterval(tick, 1000);
    // Returning from the background re-reads the wall clock immediately, so a
    // date that expired while away ends on resume instead of running long.
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') tick();
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      appStateSub.remove();
    };
  }, [session, videoAvailable]);

  // Detect when partner leaves mid-session
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (remoteParticipant) {
      partnerHasJoined.current = true;
    } else if (partnerHasJoined.current && !hasEnded.current) {
      hasEnded.current = true;
      setPartnerLeft(true);
      // Navigate to result after showing the cue
      const t = setTimeout(() => handleEnd(), 3500);
      return () => clearTimeout(t);
    }
  }, [remoteParticipant]);

  // Join via provider
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!videoAvailable || !room_url) return;
    provider.join({ roomUrl: room_url }).then(() => {
      Analytics.speedDateJoined();
    }).catch((e: any) => {
      logError(e, 'speedDateSession_join');
    });
    return () => {
      provider.leave().catch(() => {});
      provider.destroy();
    };
  }, [room_url]);

  const handleEnd = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    // Determine partner_id from session participant_ids
    const partnerId = session?.participant_ids.find((id) => id !== user?.id) ?? null;

    provider.leave().catch(() => {});

    router.replace({
      pathname: '/speed-dating/result',
      params: {
        session_id: session_id ?? '',
        liked: likedRef.current ? '1' : '0',
        partner_id: partnerId ?? '',
      },
    } as any);
  }, [session, provider, session_id, router, user]);

  const handleLeave = async () => {
    const confirmed = await confirmAction('Leave session?', 'Are you sure you want to leave early?', 'Leave');
    if (confirmed) handleEnd();
  };

  /**
   * Leaving quietly is a different promise from ending the call: no
   * confirmation, no announcement, no partner-facing cue. She is out in one
   * tap. If this ever grows a dialog it has stopped being what it says.
   */
  const handleLeaveQuietly = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    hasEnded.current = true;
    provider.leave().catch(() => {});
    router.replace('/speed-dating' as never);
  }, [provider, router]);

  const partnerId = session?.participant_ids.find((id) => id !== user?.id) ?? null;

  const handleReport = useCallback(() => {
    if (!partnerId) return;
    // 'speed_date' is a first-class report context now — reporting a live date
    // as though it were a "profile" loses the one detail a moderator needs.
    openReportModal({ userId: partnerId, contentType: 'speed_date', contentId: session_id });
  }, [partnerId, session_id, openReportModal]);

  const handleBlock = useCallback(async () => {
    if (!partnerId) return;
    try {
      await blockUser(partnerId);
      // Only after the write lands. Announcing a block that did not happen is
      // the worst possible lie on a safety control.
      handleLeaveQuietly();
    } catch (e) {
      logError(e, 'speedDate.block');
      showAlert('Could not block', 'That did not go through. Try again, or end the call.');
    }
  }, [partnerId, blockUser, handleLeaveQuietly]);

  const duration = session?.duration_seconds ?? 300;
  const prompts = session?.prompts ?? [];
  const currentPrompt = prompts[promptIndex] ?? '✨ Get to know each other!';

  // Declared after every hook so hook order stays identical across renders.
  if (!videoAvailable) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
          <View style={styles.unavailableWrap}>
            <Text style={styles.unavailableEmoji}>📵</Text>
            <Text style={styles.unavailableTitle}>Video isn't available here</Text>
            <Text style={styles.unavailableBody}>
              Speed dating runs on video, which needs the installed Roxy app — it can&apos;t run in
              the web preview. Open Roxy on your phone and your date will be waiting.
            </Text>
            <TouchableOpacity
              style={styles.unavailableBtn}
              onPress={() => router.back()}
              accessibilityLabel="Back to the speed dating lobby"
            >
              <Text style={styles.unavailableBtnText}>Back to lobby</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

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
        {remoteParticipant
          ? (provider.renderRemoteVideo(remoteParticipant, StyleSheet.absoluteFill) ?? <VideoPlaceholder label="Waiting for match…" />)
          : <VideoPlaceholder label="Waiting for match…" />
        }
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
        {provider.renderLocalVideo(StyleSheet.absoluteFill) ?? <VideoPlaceholder label="You" />}
      </View>

      {/* Partner-left overlay */}
      {partnerLeft && (
        <View style={styles.partnerLeftOverlay}>
          <Text style={styles.partnerLeftEmoji}>👋</Text>
          <Text style={styles.partnerLeftTitle}>Your match has left</Text>
          <Text style={styles.partnerLeftSub}>Taking you back to the lobby…</Text>
        </View>
      )}

      {/* Flower or pass.
          Two named choices, not one toggle. The old control was a single
          🤍/❤️ that only ever said yes — passing meant leaving the button
          alone, which is indistinguishable from not having decided. On a
          mutual-match product the difference matters: a deliberate no is a
          signal, an un-pressed button is silence. */}
      <View style={styles.choiceBar} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.pass, passed && styles.passActive]}
          onPress={() => {
            setPassed(true);
            setLiked(false);
            likedRef.current = false;
            AccessibilityInfo.announceForAccessibility('Passed. You will not be matched.');
          }}
          accessibilityRole="button"
          {...a11yState({ selected: passed })}
          accessibilityLabel="Pass. You will not be matched with her."
          activeOpacity={0.85}
          testID="speed-pass"
        >
          <Text style={styles.passText}>Pass</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.flower, liked && styles.flowerActive]}
          onPress={() => {
            setLiked(true);
            setPassed(false);
            likedRef.current = true;
            AccessibilityInfo.announceForAccessibility(
              'Flower sent. You both find out at the end.'
            );
          }}
          accessibilityRole="button"
          {...a11yState({ selected: liked })}
          accessibilityLabel="Send a flower. You both find out at the end, only if she sends one too."
          activeOpacity={0.85}
          testID="speed-flower"
        >
          <Text style={styles.flowerText}>{liked ? '✿ Flower sent' : '✿ Send a flower'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.consentFoot}>
        5-minute date · contacts shared only on a mutual ✿
      </Text>

      {/* Always visible, never a scroll away. */}
      <ConsentStrip
        onEnd={() => void handleLeave()}
        onReport={handleReport}
        onBlock={() => void handleBlock()}
        onLeaveQuietly={handleLeaveQuietly}
      />
    </View>
  );
}
