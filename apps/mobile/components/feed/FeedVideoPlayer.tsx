import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { getVideoPlaybackUrl } from '../../lib/media';

let AVModule: typeof import('expo-av') | null = null;
try { AVModule = require('expo-av'); } catch { AVModule = null; }

interface Props {
  videoUrl: string | null | undefined;
  isActive: boolean;
  isMuted: boolean;
  style?: object;
}

export function FeedVideoPlayer({ videoUrl, isActive, isMuted, style }: Props) {
  const uri = getVideoPlaybackUrl(videoUrl);
  const nativeRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || !nativeRef.current) return;
    if (isActive) void nativeRef.current.playAsync?.();
    else void nativeRef.current.pauseAsync?.();
  }, [isActive]);

  if (!uri) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.unavailable, style]}>
        <Text style={styles.unavailableText}>Video unavailable</Text>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <video
        src={uri}
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          objectFit: 'contain', backgroundColor: '#000',
        }}
        autoPlay={isActive}
        loop
        muted={isMuted}
        playsInline
        controls={false}
      />
    );
  }

  const Video = AVModule?.Video;
  const ResizeMode = AVModule?.ResizeMode;
  if (!Video) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.unavailable, style]}>
        <Text style={styles.unavailableText}>Video unavailable</Text>
      </View>
    );
  }

  return (
    <Video
      ref={nativeRef}
      source={{ uri }}
      style={[StyleSheet.absoluteFill, style]}
      resizeMode={ResizeMode?.CONTAIN ?? ('contain' as any)}
      shouldPlay={isActive}
      isLooping
      isMuted={isMuted}
    />
  );
}

const styles = StyleSheet.create({
  unavailable: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  unavailableText: { color: 'rgba(255,255,255,0.6)', fontSize: 16 },
});
