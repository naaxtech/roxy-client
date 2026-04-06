import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { callEdgeFunction } from '../../../../lib/supabase';
import { DailyProvider } from '../../../../lib/video';
import { useVideoCall } from '../../../../hooks/useVideoCall';
import { COLORS } from '../../../../lib/constants';
import { logError } from '../../../../lib/errorLogger';

export default function CommunityRoomSession() {
  const { room_id } = useLocalSearchParams<{ room_id: string }>();
  const router = useRouter();

  const [provider] = useState(() => new DailyProvider());
  const { state, remoteParticipant } = useVideoCall(provider);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [roomName, setRoomName] = useState<string | null>(null);

  useEffect(() => {
    if (!room_id) return;
    (async () => {
      try {
        const { data } = await callEdgeFunction<{ room_url: string; room_name: string }>('join-community-room', { room_id });
        if (data?.room_url) {
          setRoomName(data.room_name ?? null);
          await provider.join({ roomUrl: data.room_url });
        }
      } catch (e: any) {
        logError(e, 'communityRoomSession_join');
        Alert.alert('Error', 'Failed to join room. Please try again.');
        router.back();
      }
    })();
    return () => {
      provider.leave().catch(() => {});
      provider.destroy();
    };
  }, [room_id]);

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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Remote video */}
      <View style={styles.remoteVideo}>
        {remoteParticipant
          ? provider.renderRemoteVideo(remoteParticipant, StyleSheet.absoluteFillObject) ?? (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderIcon}>👤</Text>
              <Text style={styles.placeholderText}>Remote participant</Text>
            </View>
          )
          : (
            <View style={styles.placeholder}>
              {state === 'connecting' ? (
                <ActivityIndicator color={COLORS.roxy} size="large" />
              ) : (
                <>
                  <Text style={styles.placeholderIcon}>🎥</Text>
                  <Text style={styles.placeholderText}>
                    {state === 'connected' ? 'Waiting for others...' : 'Connecting...'}
                  </Text>
                </>
              )}
            </View>
          )
        }
      </View>

      {/* Self PiP */}
      <View style={styles.selfPip}>
        {provider.renderLocalVideo(StyleSheet.absoluteFillObject) ?? (
          <View style={[StyleSheet.absoluteFillObject, styles.pipPlaceholder]}>
            <Text style={styles.pipIcon}>👤</Text>
          </View>
        )}
      </View>

      {/* Top bar */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <View style={styles.topBarInner}>
          <TouchableOpacity onPress={handleLeave} style={styles.backBtn}>
            <Ionicons name="arrow-back-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.roomTitle} numberOfLines={1}>{roomName ?? 'Community Room'}</Text>
          <View style={styles.statusDot}>
            <View style={[styles.dot, state === 'connected' && styles.dotLive]} />
            <Text style={styles.statusText}>{state === 'connected' ? 'Live' : state}</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom controls */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <View style={styles.controls}>
          <TouchableOpacity style={[styles.controlBtn, !micOn && styles.controlBtnOff]} onPress={toggleMic}>
            <Ionicons name={micOn ? 'mic-outline' : 'mic-off-outline'} size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.controlBtn, !camOn && styles.controlBtnOff]} onPress={toggleCam}>
            <Ionicons name={camOn ? 'videocam-outline' : 'videocam-off-outline'} size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.controlBtn, styles.controlBtnLeave]} onPress={handleLeave}>
            <Ionicons name="call-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  remoteVideo: { ...StyleSheet.absoluteFillObject },
  placeholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0d0520', gap: 12,
  },
  placeholderIcon: { fontSize: 56 },
  placeholderText: { color: COLORS.textMuted, fontSize: 16 },
  selfPip: {
    position: 'absolute', top: 100, right: 16,
    width: 90, height: 130, borderRadius: 12,
    overflow: 'hidden', backgroundColor: COLORS.surface,
    borderWidth: 2, borderColor: COLORS.primary,
    zIndex: 10,
  },
  pipPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  pipIcon: { fontSize: 24 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
  topBarInner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backBtn: { padding: 4 },
  roomTitle: {
    flex: 1, color: '#fff', fontWeight: '700', fontSize: 15,
  },
  statusDot: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.textMuted },
  dotLive: { backgroundColor: COLORS.success },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '600' },
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
