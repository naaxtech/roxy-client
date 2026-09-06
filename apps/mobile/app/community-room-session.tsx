// The live call stage. This is a ROOT route on purpose: the screen must overlay
// whatever tab the user came from. It previously also existed at
// /(tabs)/connect/community-room-session, which left a dead call screen as the
// Connect stack's top route after leaving — tapping the tab re-entered it. Two
// routes rendering one call screen also meant two ways to reach a screen that
// may hold the process's only Daily call object. There is now exactly one route
// and one file; do not re-add a nested copy.
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  StatusBar, FlatList, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { callEdgeFunction } from '../lib/supabase';
import { DailyProvider } from '../lib/video';
import { useVideoCall } from '../hooks/useVideoCall';
import { useThemeColors } from '../hooks/useThemeColors';
import { logError } from '../lib/errorLogger';
import { showAlert, confirmAction } from '../lib/confirm';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useSafetyStore } from '../store/safetyStore';
import { ConsentStrip } from '../components/rooms/ConsentStrip';
import { handLabel, setRoomHand } from '../lib/roomHands';
import { roomReportTarget, roomBlockTarget } from './roomSafety';
import { useAppWidth } from '../hooks/useAppWidth';
import type { RemoteParticipant } from '../lib/video/VideoCallProvider';

// Always-dark video-stage palette — this screen stays visually consistent
// regardless of the app's light/dark theme (a call stage is not a themed surface).
const STAGE_BG = '#0d0520';
const STAGE_SURFACE = '#1a0a2e';

const EMPTY_COPY = 'Waiting for others to join 🌸';

type RoomInfo = {
  room_url: string;
  room_name: string;
  room_type: 'video' | 'audio';
  is_host: boolean;
  token: string | null;
};

type TileStyles = {
  videoTile: object;
  tileNoVideo: object;
  tileInitial: object;
  tileLabel: object;
  hostBadge: object;
  hostBadgeText: object;
  tileName: object;
};

type AudioStyles = {
  audioBubbleWrap: object;
  audioBubble: object;
  audioBubbleSpeaking: object;
  audioBubbleInitial: object;
  audioBubbleNameRow: object;
  hostBadge: object;
  hostBadgeText: object;
  audioBubbleName: object;
};

/** Friendly copy for known join-failure reasons — mapped from the join edge
 *  function's actual HTTP status codes (see
 *  supabase/functions/join-community-room/index.ts): 409 room not started,
 *  410 room closed, 403 not a community member, 404 room not found. */
function joinErrorCopy(status: number | undefined, message: string | null): { title: string; message: string } {
  switch (status) {
    case 409:
      return { title: 'Not live yet', message: 'This room is scheduled but not open yet.' };
    case 410:
      return { title: 'Room closed', message: 'This room has ended.' };
    case 403:
      return { title: 'Members only', message: 'Join this community to enter its rooms.' };
    case 404:
      return { title: 'Room unavailable', message: 'This room could not be found.' };
    case 503:
      return {
        title: 'Rooms are down',
        message: 'Live rooms are temporarily unavailable. This one is on us — try again shortly.',
      };
    default:
      return {
        title: "We couldn't reach the room",
        message: message
          ? `${message}. Check your connection and try again.`
          : 'Check your connection and try again.',
      };
  }
}

/** Turn a Daily.co join rejection into copy that says which of the three
 *  distinguishable things went wrong — the room filled up, the room is gone,
 *  or we never reached it. The raw reason goes to the logger, not the user. */
function connectErrorCopy(e: unknown): { title: string; message: string } {
  const reason = (e instanceof Error ? e.message : String(e)).toLowerCase();

  if (reason.includes('full') || reason.includes('max-participants')) {
    return { title: 'Room is full', message: 'This room has hit its limit. Try again in a few minutes.' };
  }
  if (
    reason.includes('expired') || reason.includes('ended') ||
    reason.includes('not found') || reason.includes('does not exist') ||
    reason.includes('no longer')
  ) {
    return { title: 'Room ended', message: 'This room has already wrapped up.' };
  }
  if (reason.includes('permission') || reason.includes('denied') || reason.includes('not-allowed')) {
    return {
      title: 'Camera and mic blocked',
      message: 'Roxy needs camera and microphone access to join a room. Enable them in Settings.',
    };
  }
  return {
    title: "We couldn't reach the room",
    message: 'Something went wrong on the way in. Check your connection and try again.',
  };
}

// ─── Video tile for a single participant ────────────────────────────────────
function VideoTile({
  participant, provider, onLongPress, tileStyles,
}: {
  participant: RemoteParticipant;
  provider: DailyProvider;
  isHost: boolean;
  onLongPress?: () => void;
  tileStyles: TileStyles;
}) {
  return (
    <TouchableOpacity
      style={tileStyles.videoTile}
      onLongPress={onLongPress}
      delayLongPress={600}
      activeOpacity={0.9}
      accessibilityLabel={`${participant.displayName ?? 'Guest'}${onLongPress ? ' — long press to mute' : ''}`}
    >
      {provider.renderRemoteVideo(participant, StyleSheet.absoluteFillObject) ?? (
        <View style={[StyleSheet.absoluteFillObject, tileStyles.tileNoVideo]}>
          <Text style={tileStyles.tileInitial}>
            {participant.displayName?.[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
      )}
      <View style={tileStyles.tileLabel}>
        {participant.isOwner && (
          <View style={tileStyles.hostBadge}>
            <Text style={tileStyles.hostBadgeText}>👑 Host</Text>
          </View>
        )}
        <Text style={tileStyles.tileName} numberOfLines={1}>
          {participant.displayName ?? 'Guest'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Audio bubble for a single participant ───────────────────────────────────
function AudioBubble({ participant, onLongPress, audioStyles }: {
  participant: RemoteParticipant;
  onLongPress?: () => void;
  audioStyles: AudioStyles;
}) {
  const trackInfo = participant.trackInfo as any;
  const isSpeaking = trackInfo?.tracks?.audio?.state === 'playable';
  return (
    <TouchableOpacity
      style={audioStyles.audioBubbleWrap}
      onLongPress={onLongPress}
      delayLongPress={600}
      activeOpacity={0.9}
      accessibilityLabel={`${participant.displayName ?? 'Guest'}${onLongPress ? ' — long press to mute' : ''}`}
    >
      <View style={[audioStyles.audioBubble, isSpeaking && audioStyles.audioBubbleSpeaking]}>
        <Text style={audioStyles.audioBubbleInitial}>
          {participant.displayName?.[0]?.toUpperCase() ?? '?'}
        </Text>
      </View>
      <View style={audioStyles.audioBubbleNameRow}>
        {participant.isOwner && (
          <View style={audioStyles.hostBadge}>
            <Text style={audioStyles.hostBadgeText}>👑</Text>
          </View>
        )}
        <Text style={audioStyles.audioBubbleName} numberOfLines={1}>
          {participant.displayName ?? 'Guest'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function CommunityRoomSession() {
  const { room_id } = useLocalSearchParams<{ room_id: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const appWidth = useAppWidth();
  const TILE_SIZE = (appWidth - 36) / 2; // 2-col grid, 12px padding each side + 12px gap

  const [provider] = useState(() => new DailyProvider());
  const { state, remoteParticipants, localVideoVersion, localMediaState } = useVideoCall(provider);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  // The room's creator. `join-community-room` does not return it, and the
  // ConsentStrip needs a subject: a report hands a moderator the session, and a
  // block has to be about a person. See app/roomSafety.ts.
  const [hostId, setHostId] = useState<string | null>(null);
  const [handRaised, setHandRaised] = useState(false);

  // Real provider state, not a client-side guess. Defaults match the actual
  // join params (startAudioOff: true, camera on) until the first sync arrives.
  const micOn = localMediaState?.audio ?? false;
  const camOn = localMediaState?.video ?? true;

  const dailyUnavailable = !provider.isAvailable;

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: STAGE_BG },
    content: { flex: 1, marginTop: 90, marginBottom: 80 },

    // Placeholder
    placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    placeholderIcon: { fontSize: 56 },
    placeholderText: { color: colors.textMuted, fontSize: 16, textAlign: 'center', paddingHorizontal: 32 },

    // Web / Expo Go fallback (Daily unavailable)
    unavailable: {
      flex: 1, backgroundColor: STAGE_BG,
      alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32,
    },
    unavailableIcon: { fontSize: 52 },
    unavailableTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', lineHeight: 25 },
    unavailableBody: { color: '#C4B5D4', fontSize: 14, textAlign: 'center', lineHeight: 20 },
    unavailableBackBtn: {
      marginTop: 8, minHeight: 44, minWidth: 120,
      borderRadius: 22, paddingHorizontal: 22,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.roxy,
    },
    unavailableBackText: { color: '#fff', fontWeight: '800', fontSize: 14 },

    // Video grid
    videoGrid: { padding: 12 },
    videoGridRow: { gap: 12, marginBottom: 12 },
    videoTile: {
      width: TILE_SIZE, height: TILE_SIZE * 1.2,
      borderRadius: 12, overflow: 'hidden',
      backgroundColor: STAGE_SURFACE,
    },
    tileNoVideo: { alignItems: 'center', justifyContent: 'center', backgroundColor: STAGE_SURFACE },
    tileInitial: { fontSize: 36, color: colors.textMuted },
    tileLabel: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 8, paddingVertical: 6,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    tileName: { flex: 1, color: '#fff', fontSize: 12, fontWeight: '600' },

    // Audio grid
    audioGrid: {
      flexDirection: 'row', flexWrap: 'wrap',
      padding: 12, gap: 16, justifyContent: 'center',
    },
    audioBubbleWrap: { alignItems: 'center', width: 80, gap: 6 },
    audioBubble: {
      width: 64, height: 64, borderRadius: 32,
      backgroundColor: colors.primary + '40',
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: 'transparent',
    },
    audioBubbleSpeaking: { borderColor: colors.primary },
    audioBubbleInitial: { fontSize: 24, color: colors.textPrimary, fontWeight: '700' },
    audioBubbleNameRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    audioBubbleName: {
      color: colors.textSecondary, fontSize: 11, fontWeight: '600', maxWidth: 68,
    },

    // Host pill badge (shared: video tiles + audio bubbles + self PiP)
    hostBadge: {
      flexDirection: 'row', alignItems: 'center',
      borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2,
      backgroundColor: colors.roxy,
    },
    hostBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },

    // Self PiP
    selfPip: {
      position: 'absolute', top: 100, right: 16,
      width: 90, height: 130, borderRadius: 12,
      overflow: 'hidden', backgroundColor: STAGE_SURFACE,
      borderWidth: 2, borderColor: colors.primary, zIndex: 10,
    },
    pipPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    pipIcon: { fontSize: 24 },
    pipHostBadge: { position: 'absolute', top: 4, left: 4 },

    // Top bar
    topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
    topBarInner: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 12, paddingVertical: 8,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    backBtn: {
      minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    },
    roomTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },

    // Status pill (reuses CommunityRoomCard's LIVE-pill visual language)
    statusPill: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
      backgroundColor: 'rgba(26,10,46,0.55)',
    },
    statusPillLive: { backgroundColor: '#E5484D' },
    statusPulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
    statusText: { color: '#fff', fontSize: 11, fontWeight: '800' },

    // Bottom bar
    bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20 },
    controls: {
      flexDirection: 'row', justifyContent: 'center', gap: 16,
      paddingVertical: 12, paddingHorizontal: 24,
      backgroundColor: 'rgba(0,0,0,0.7)',
    },
    controlBtn: {
      width: 50, height: 50, borderRadius: 25,
      backgroundColor: 'rgba(255,255,255,0.2)',
      alignItems: 'center', justifyContent: 'center',
    },
    controlBtnOff: { backgroundColor: 'rgba(255,255,255,0.1)' },
    controlBtnLeave: { backgroundColor: colors.error },
    handBtn: {
      flex: 1, minHeight: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
      backgroundColor: 'rgba(255,255,255,0.08)',
    },
    handBtnOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    handBtnText: { color: '#FFF8FB', fontWeight: '700', fontSize: 13 },
    handHint: {
      color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '600',
      textAlign: 'center', paddingBottom: 6,
    },
  });

  // Join the room once we know Daily is available and we have a room_id.
  //
  // Join and teardown MUST stay in the same effect. daily-js allows one call
  // object per process, so the run that created it has to be the run that
  // releases it — when teardown lived in a separate effect, leaving this screen
  // any way other than the Leave button (hardware back, swipe, error path)
  // could strand the instance and every later room join failed with a generic
  // "Failed to connect to the room" until the app was restarted.
  useEffect(() => {
    if (!provider.isAvailable) return; // web / Expo Go — friendly fallback renders instead

    let cancelled = false;

    if (!room_id) {
      (async () => {
        await showAlert('Room unavailable', "We couldn't find that room.");
        if (!cancelled) router.back();
      })();
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      const { data, error, status } = await callEdgeFunction<RoomInfo>('join-community-room', { room_id });
      if (cancelled) return;

      if (error || !data?.room_url) {
        logError(new Error(error ?? 'join-community-room: missing room_url'), 'communityRoomSession_join');
        const { title, message } = joinErrorCopy(status, error);
        await showAlert(title, message);
        if (!cancelled) router.back();
        return;
      }

      setRoomInfo(data);
      try {
        await provider.join({
          roomUrl: data.room_url,
          token: data.token ?? undefined,
          startAudioOff: true,
        });
      } catch (e) {
        if (cancelled) return;
        // The underlying reason (Daily's own message) reaches Crashlytics and
        // PostHog here — the user gets the mapped copy, never the raw string.
        logError(e, 'communityRoomSession_daily_join');
        const { title, message } = connectErrorCopy(e);
        await showAlert(title, message);
        router.back();
      }
    })();

    return () => {
      cancelled = true;
      provider.leave().catch(() => {});
      provider.destroy();
    };
  }, [room_id, provider, router]);

  const viewerId = useAuthStore((st) => st.user?.id ?? null);
  const openReportModal = useSafetyStore((st) => st.openReportModal);
  const blockUser = useSafetyStore((st) => st.blockUser);

  // Who opened the room. join-community-room does not return it, so it is read
  // here — the strip needs a subject before it can offer report or block.
  useEffect(() => {
    if (!room_id) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('community_rooms')
        .select('created_by')
        .eq('id', room_id)
        .maybeSingle();
      if (cancelled) return;
      if (error) { logError(error, 'roomSession_loadHost'); return; }
      setHostId((data as { created_by?: string } | null)?.created_by ?? null);
    })();
    return () => { cancelled = true; };
  }, [room_id]);

  const handleReport = () => {
    const target = roomReportTarget({ roomId: String(room_id ?? ''), hostId });
    if (!target) {
      showAlert('Cannot report yet', 'We could not identify this room. Leave and try from the community page.');
      return;
    }
    openReportModal(target);
  };

  const handleBlock = async () => {
    const target = roomBlockTarget({ hostId, viewerId });
    if (!target) {
      showAlert('Nothing to block', 'This room has no other host to block.');
      return;
    }
    const ok = await confirmAction(
      'Block the host?',
      // Precise, because the previous wording promised more than a block does.
      // A block hides her posts, profile and DMs and keeps her out of your
      // speed-date queue (102) — it does NOT stop you both being in the same
      // community room, which is a many-person space nobody is matched into.
      'She will not see your posts or profile, she cannot message you, and you will never be matched in Speed Dating. She can still open community rooms. You will leave this one now.',
      'Block'
    );
    if (!ok) return;
    try {
      await blockUser(target);
    } catch (e) {
      // blockUser throws on a failed RPC. Never say "blocked" over a write that
      // did not land — this app has told a woman she was protected when she
      // was not, and it is the reason that store re-reads its own state.
      logError(e, 'roomSession_block');
      showAlert('Not blocked', 'We could not block her. Check your connection and try again.');
      return;
    }
    await provider.leave().catch(() => {});
    router.back();
  };

  /**
   * Leave without telling anyone.
   *
   * Different promise from the Leave button, which confirms first. Nobody is
   * notified and nothing is announced — that is the whole point of the control,
   * and it is why it does not reuse handleLeave.
   */
  const handleLeaveQuietly = async () => {
    await provider.leave().catch(() => {});
    router.back();
  };

  const handleLeave = async () => {
    const ok = await confirmAction('Leave Room?', 'Are you sure you want to leave?', 'Leave');
    if (!ok) return;
    await provider.leave().catch(() => {});
    router.back();
  };

  const toggleMic = () => provider.toggleMic();
  const toggleCam = () => provider.toggleCamera();

  const handleMuteParticipant = async (participant: RemoteParticipant) => {
    if (!roomInfo?.is_host) return;
    const ok = await confirmAction(
      `Mute ${participant.displayName ?? 'participant'}?`,
      'They will be muted. They can unmute themselves.',
      'Mute',
    );
    if (ok) provider.muteParticipant(participant.id);
  };

  const isVideo = roomInfo?.room_type === 'video';
  const participantCount = remoteParticipants.length;

  // Host pushes the authoritative participant count whenever the HEADCOUNT
  // changes.
  //
  // This depended on `remoteParticipants` itself, and onParticipantUpdated
  // rebuilds that array on every update — an event Daily fires ~10x/second per
  // participant for ordinary mic/camera track changes (anti-pattern 9). The
  // effect therefore re-ran continuously and fired one manage-room call each
  // time, for a number that had not moved. Depending on the length collapses
  // that to one write per actual join or leave.
  useEffect(() => {
    if (!roomInfo?.is_host || !room_id) return;
    const count = participantCount + 1; // remotes + self
    callEdgeFunction('manage-room', { action: 'sync-count', room_id, count }).then(({ error }) => {
      if (error) logError(new Error(error), 'communityRoomSession_syncCount');
    });
  }, [participantCount, roomInfo?.is_host, room_id]);

  const tileStyles: TileStyles = {
    videoTile: styles.videoTile,
    tileNoVideo: styles.tileNoVideo,
    tileInitial: styles.tileInitial,
    tileLabel: styles.tileLabel,
    hostBadge: styles.hostBadge,
    hostBadgeText: styles.hostBadgeText,
    tileName: styles.tileName,
  };

  const audioStyles: AudioStyles = {
    audioBubbleWrap: styles.audioBubbleWrap,
    audioBubble: styles.audioBubble,
    audioBubbleSpeaking: styles.audioBubbleSpeaking,
    audioBubbleInitial: styles.audioBubbleInitial,
    audioBubbleNameRow: styles.audioBubbleNameRow,
    hostBadge: styles.hostBadge,
    hostBadgeText: styles.hostBadgeText,
    audioBubbleName: styles.audioBubbleName,
  };

  // ── Daily unavailable (web / Expo Go): friendly degrade, never a crash or blank screen ──
  if (dailyUnavailable) {
    return (
      <SafeAreaView style={styles.unavailable} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.unavailableIcon}>🎥</Text>
        <Text style={styles.unavailableTitle}>Video rooms work in the Roxy app 💜</Text>
        <Text style={styles.unavailableBody}>
          Audio-video isn&apos;t available in the browser yet.
        </Text>
        <TouchableOpacity
          style={styles.unavailableBackBtn}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
        >
          <Text style={styles.unavailableBackText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* ── Content area ──────────────────────────────────────────────── */}
      <View style={styles.content}>
        {state === 'connecting' || !roomInfo ? (
          <View style={styles.placeholder}>
            <ActivityIndicator color={colors.roxy} size="large" />
            <Text style={styles.placeholderText}>Joining room...</Text>
          </View>
        ) : isVideo ? (
          /* Video grid */
          remoteParticipants.length === 0 ? (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderIcon}>🎥</Text>
              <Text style={styles.placeholderText}>{EMPTY_COPY}</Text>
            </View>
          ) : (
            <FlatList
              data={remoteParticipants}
              keyExtractor={(p) => p.id}
              numColumns={2}
              contentContainerStyle={styles.videoGrid}
              columnWrapperStyle={styles.videoGridRow}
              renderItem={({ item }) => (
                <VideoTile
                  participant={item}
                  provider={provider}
                  isHost={roomInfo.is_host}
                  onLongPress={roomInfo.is_host ? () => handleMuteParticipant(item) : undefined}
                  tileStyles={tileStyles}
                />
              )}
            />
          )
        ) : (
          /* Audio bubble grid */
          <ScrollView contentContainerStyle={styles.audioGrid}>
            {remoteParticipants.length === 0 ? (
              <View style={styles.placeholder}>
                <Text style={styles.placeholderIcon}>🎙️</Text>
                <Text style={styles.placeholderText}>{EMPTY_COPY}</Text>
              </View>
            ) : (
              remoteParticipants.map((p) => (
                <AudioBubble
                  key={p.id}
                  participant={p}
                  onLongPress={roomInfo.is_host ? () => handleMuteParticipant(p) : undefined}
                  audioStyles={audioStyles}
                />
              ))
            )}
          </ScrollView>
        )}
      </View>

      {/* ── Self PiP (video rooms only) ────────────────────────────────── */}
      {isVideo && (
        <View key={localVideoVersion} style={styles.selfPip}>
          {provider.renderLocalVideo(StyleSheet.absoluteFillObject) ?? (
            <View style={[StyleSheet.absoluteFillObject, styles.pipPlaceholder]}>
              <Text style={styles.pipIcon}>👤</Text>
            </View>
          )}
          {roomInfo?.is_host && (
            <View style={[styles.hostBadge, styles.pipHostBadge]}>
              <Text style={styles.hostBadgeText}>👑</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <View style={styles.topBarInner}>
          <TouchableOpacity onPress={handleLeave} style={styles.backBtn} accessibilityLabel="Leave room">
            <Ionicons name="arrow-back-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.roomTitle} numberOfLines={1}>
              {roomInfo?.room_name ?? 'Community Room'}
            </Text>
          </View>
          <View style={[styles.statusPill, state === 'connected' && styles.statusPillLive]}>
            {state === 'connected' && <View style={styles.statusPulse} />}
            <Text style={styles.statusText}>
              {state === 'connected' ? `Live · ${participantCount + 1}` : state}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      {/* ── The way out ─────────────────────────────────────────────────
          Pinned, above the media controls, present in every frame. This screen
          shipped with a Leave button and nothing else: a woman being talked
          over in a live room had no report and no block without backing out
          first. Speed dating has had this strip since it was built; the room
          is the surface where a stranger reaches a whole community. */}
      <ConsentStrip
        onEnd={() => void handleLeave()}
        onReport={handleReport}
        onBlock={() => void handleBlock()}
        onLeaveQuietly={() => void handleLeaveQuietly()}
      />

      {/* ── Bottom controls ─────────────────────────────────────────────── */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        {!isVideo ? (
          <>
            <Text style={styles.handHint}>Mics are invite-only · raise your hand to speak · report is anonymous</Text>
            <View style={[styles.controls, { paddingTop: 0 }]}>
              <TouchableOpacity
                style={[styles.handBtn, handRaised && styles.handBtnOn]}
                onPress={() => {
                  const next = !handRaised;
                  setHandRaised(next);
                  if (room_id && viewerId) void setRoomHand(room_id, viewerId, next);
                }}
                accessibilityRole="button"
                accessibilityLabel={handLabel(handRaised)}
                testID="room-raise-hand"
              >
                <Text style={styles.handBtnText}>{handRaised ? '✋ ' : ''}{handLabel(handRaised)}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.controlBtn, !micOn && styles.controlBtnOff]}
            onPress={toggleMic}
            accessibilityLabel={micOn ? 'Mute microphone' : 'Unmute microphone'}
          >
            <Ionicons name={micOn ? 'mic-outline' : 'mic-off-outline'} size={22} color="#fff" />
          </TouchableOpacity>
          {isVideo && (
            <TouchableOpacity
              style={[styles.controlBtn, !camOn && styles.controlBtnOff]}
              onPress={toggleCam}
              accessibilityLabel={camOn ? 'Turn off camera' : 'Turn on camera'}
            >
              <Ionicons
                name={camOn ? 'videocam-outline' : 'videocam-off-outline'}
                size={22}
                color="#fff"
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.controlBtn, styles.controlBtnLeave]}
            onPress={handleLeave}
            accessibilityLabel="Leave room"
          >
            <Ionicons name="call-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}
