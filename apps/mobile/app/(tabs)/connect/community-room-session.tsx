import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  StatusBar, Alert, FlatList, ScrollView, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { callEdgeFunction } from '../../../lib/supabase';
import { DailyProvider } from '../../../lib/video';
import { useVideoCall } from '../../../hooks/useVideoCall';
import { COLORS } from '../../../lib/constants';
import { logError } from '../../../lib/errorLogger';
import type { RemoteParticipant } from '../../../lib/video/VideoCallProvider';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TILE_SIZE = (SCREEN_WIDTH - 36) / 2; // 2-col grid, 12px padding each side + 12px gap

type RoomInfo = {
  room_url: string;
  room_name: string;
  room_type: 'video' | 'audio';
  is_host: boolean;
  token: string | null;
};

// ─── Video tile for a single participant ────────────────────────────────────
function VideoTile({
  participant, provider, isHost: _isHost, onLongPress,
}: {
  participant: RemoteParticipant;
  provider: DailyProvider;
  isHost: boolean;
  onLongPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.videoTile}
      onLongPress={onLongPress}
      delayLongPress={600}
      activeOpacity={0.9}
    >
      {provider.renderRemoteVideo(participant, StyleSheet.absoluteFillObject) ?? (
        <View style={[StyleSheet.absoluteFillObject, styles.tileNoVideo]}>
          <Text style={styles.tileInitial}>
            {participant.displayName?.[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
      )}
      <View style={styles.tileLabel}>
        {participant.isOwner && <Text style={styles.tileOwnerBadge}>👑</Text>}
        <Text style={styles.tileName} numberOfLines={1}>
          {participant.displayName ?? 'Guest'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Audio bubble for a single participant ───────────────────────────────────
function AudioBubble({ participant, onLongPress }: {
  participant: RemoteParticipant;
  onLongPress?: () => void;
}) {
  const trackInfo = participant.trackInfo as any;
  const isSpeaking = trackInfo?.tracks?.audio?.state === 'playable';
  return (
    <TouchableOpacity
      style={styles.audioBubbleWrap}
      onLongPress={onLongPress}
      delayLongPress={600}
      activeOpacity={0.9}
    >
      <View style={[styles.audioBubble, isSpeaking && styles.audioBubbleSpeaking]}>
        <Text style={styles.audioBubbleInitial}>
          {participant.displayName?.[0]?.toUpperCase() ?? '?'}
        </Text>
      </View>
      <View style={styles.audioBubbleNameRow}>
        {participant.isOwner && <Text style={styles.audioBubbleOwner}>👑</Text>}
        <Text style={styles.audioBubbleName} numberOfLines={1}>
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

  const [provider] = useState(() => new DailyProvider());
  const { state, remoteParticipants, localVideoVersion } = useVideoCall(provider);

  const [micOn, setMicOn] = useState(false); // starts muted
  const [camOn, setCamOn] = useState(true);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);

  useEffect(() => {
    if (!room_id) return;
    (async () => {
      try {
        const { data } = await callEdgeFunction<RoomInfo & { status?: number }>(
          'join-community-room',
          { room_id },
        );

        if (!data?.room_url) {
          Alert.alert('Room unavailable', 'This room is not live right now.');
          router.back();
          return;
        }

        setRoomInfo(data);
        await provider.join({
          roomUrl: data.room_url,
          token: data.token ?? undefined,
          startAudioOff: true,
        });
      } catch (e: any) {
        logError(e, 'communityRoomSession_join');
        const status = e?.status ?? e?.statusCode;
        if (status === 409) {
          Alert.alert('Not live yet', 'This room is scheduled but not open yet.', [
            { text: 'OK', onPress: () => router.back() },
          ]);
        } else if (status === 410) {
          Alert.alert('Room closed', 'This room has ended.', [
            { text: 'OK', onPress: () => router.back() },
          ]);
        } else {
          Alert.alert('Error', 'Failed to join room. Please try again.');
          router.back();
        }
      }
    })();
    return () => {
      provider.leave().catch(() => {});
      provider.destroy();
    };
  }, [room_id, provider, router]);

  const handleLeave = () => {
    Alert.alert('Leave Room?', 'Are you sure you want to leave?', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive',
        onPress: () => {
          provider.leave().catch(() => {});
          router.back();
        },
      },
    ]);
  };

  const toggleMic = () => {
    provider.toggleMic();
    setMicOn((v) => !v);
  };

  const toggleCam = () => {
    provider.toggleCamera();
    setCamOn((v) => !v);
  };

  const handleMuteParticipant = (participant: RemoteParticipant) => {
    if (!roomInfo?.is_host) return;
    Alert.alert(
      `Mute ${participant.displayName ?? 'participant'}?`,
      'They will be muted. They can unmute themselves.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mute',
          style: 'destructive',
          onPress: () => provider.muteParticipant(participant.id),
        },
      ],
    );
  };

  const isVideo = roomInfo?.room_type === 'video';
  const participantCount = remoteParticipants.length;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* ── Content area ──────────────────────────────────────────────── */}
      <View style={styles.content}>
        {state === 'connecting' || !roomInfo ? (
          <View style={styles.placeholder}>
            <ActivityIndicator color={COLORS.roxy} size="large" />
            <Text style={styles.placeholderText}>Joining room...</Text>
          </View>
        ) : isVideo ? (
          /* Video grid */
          remoteParticipants.length === 0 ? (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderIcon}>🎥</Text>
              <Text style={styles.placeholderText}>Waiting for others...</Text>
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
                <Text style={styles.placeholderText}>Waiting for others...</Text>
              </View>
            ) : (
              remoteParticipants.map((p) => (
                <AudioBubble
                  key={p.id}
                  participant={p}
                  onLongPress={roomInfo.is_host ? () => handleMuteParticipant(p) : undefined}
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
          {roomInfo?.is_host && <Text style={styles.pipOwnerBadge}>👑</Text>}
        </View>
      )}

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <View style={styles.topBarInner}>
          <TouchableOpacity onPress={handleLeave} style={styles.backBtn}>
            <Ionicons name="arrow-back-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.roomTitle} numberOfLines={1}>
              {roomInfo?.room_name ?? 'Community Room'}
            </Text>
          </View>
          <View style={styles.statusRow}>
            <View style={[styles.dot, state === 'connected' && styles.dotLive]} />
            <Text style={styles.statusText}>
              {state === 'connected' ? `Live · ${participantCount + 1}` : state}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      {/* ── Bottom controls ─────────────────────────────────────────────── */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.controlBtn, !micOn && styles.controlBtnOff]}
            onPress={toggleMic}
          >
            <Ionicons name={micOn ? 'mic-outline' : 'mic-off-outline'} size={22} color="#fff" />
          </TouchableOpacity>
          {isVideo && (
            <TouchableOpacity
              style={[styles.controlBtn, !camOn && styles.controlBtnOff]}
              onPress={toggleCam}
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
          >
            <Ionicons name="call-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { flex: 1, marginTop: 90, marginBottom: 80 },

  // Placeholder
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  placeholderIcon: { fontSize: 56 },
  placeholderText: { color: COLORS.textMuted, fontSize: 16 },

  // Video grid
  videoGrid: { padding: 12 },
  videoGridRow: { gap: 12, marginBottom: 12 },
  videoTile: {
    width: TILE_SIZE, height: TILE_SIZE * 1.2,
    borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#1a0a2e',
  },
  tileNoVideo: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a0a2e' },
  tileInitial: { fontSize: 36, color: COLORS.textMuted },
  tileLabel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  tileOwnerBadge: { fontSize: 13 },
  tileName: { flex: 1, color: '#fff', fontSize: 12, fontWeight: '600' },

  // Audio grid
  audioGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    padding: 12, gap: 16, justifyContent: 'center',
  },
  audioBubbleWrap: { alignItems: 'center', width: 80, gap: 6 },
  audioBubble: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: COLORS.primary + '40',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  audioBubbleSpeaking: { borderColor: COLORS.primary },
  audioBubbleInitial: { fontSize: 24, color: COLORS.textPrimary, fontWeight: '700' },
  audioBubbleNameRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  audioBubbleOwner: { fontSize: 10 },
  audioBubbleName: {
    color: COLORS.textSecondary, fontSize: 11, fontWeight: '600', maxWidth: 68,
  },

  // Self PiP
  selfPip: {
    position: 'absolute', top: 100, right: 16,
    width: 90, height: 130, borderRadius: 12,
    overflow: 'hidden', backgroundColor: COLORS.surface,
    borderWidth: 2, borderColor: COLORS.primary, zIndex: 10,
  },
  pipPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  pipIcon: { fontSize: 24 },
  pipOwnerBadge: { position: 'absolute', top: 4, left: 4, fontSize: 12 },

  // Top bar
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
  topBarInner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backBtn: { padding: 4 },
  roomTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.textMuted },
  dotLive: { backgroundColor: COLORS.success },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '600' },

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
  controlBtnLeave: { backgroundColor: COLORS.error },
});
