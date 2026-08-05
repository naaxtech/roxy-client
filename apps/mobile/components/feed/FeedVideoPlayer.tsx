import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { getVideoPlaybackUrl, getPostImageUrl } from '../../lib/media';

let AVModule: typeof import('expo-av') | null = null;
try { AVModule = require('expo-av'); } catch { AVModule = null; }

type AvVideoInstance = InstanceType<typeof import('expo-av').Video>;

/**
 * How many cells either side of the active one keep a decoder alive.
 *
 * Android and iOS both cap concurrent hardware decoders (commonly 4–8), and a
 * recycled list that leaves every mounted cell holding one starves the active
 * video: it stalls on a black frame instead of playing. One cell each side is
 * enough for a swipe to be instant, two is the safety margin for a fast flick.
 */
const DECODER_WINDOW = 2;

interface Props {
  videoUrl: string | null | undefined;
  isActive: boolean;
  isMuted: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Thumbnail shown until the first frame is decoded, and whenever this cell is
   * too far from the active one to hold a decoder. Without it a swipe lands on
   * black.
   */
  posterUrl?: string | null;
  /** This cell's position in the list. Omit outside a list. */
  index?: number;
  /** The list's active cell. Omit outside a list. */
  activeIndex?: number;
  /** Playback progress, for a scrub/progress bar. Only fires while active. */
  onProgress?: (positionMillis: number, durationMillis: number) => void;
}

export function FeedVideoPlayer({
  videoUrl, isActive, isMuted, style, posterUrl, index, activeIndex, onProgress,
}: Props) {
  const uri = getVideoPlaybackUrl(videoUrl);
  const posterUri = posterUrl ? getPostImageUrl(posterUrl, 'detail') : null;
  const nativeRef = useRef<AvVideoInstance | null>(null);
  const webRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);

  // Cells outside the window release their source so the active video always
  // gets a decoder. `index`/`activeIndex` omitted (single-video screens) means
  // "always near" — there is nothing to compete with.
  const near =
    index == null || activeIndex == null || Math.abs(index - activeIndex) <= DECODER_WINDOW;

  // A recycled cell shows the previous clip's last frame until the new one
  // decodes; forget readiness whenever the clip changes.
  useEffect(() => { setReady(false); }, [uri]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const el = webRef.current;
      if (!el) return;
      if (isActive) void el.play().catch(() => { /* autoplay policy — poster stays */ });
      else el.pause();
      return;
    }
    const player = nativeRef.current;
    if (!player) return;
    if (isActive) void player.playAsync().catch(() => { /* not loaded yet */ });
    else void player.pauseAsync().catch(() => { /* not loaded yet */ });
  }, [isActive]);

  const handleStatus = useCallback((status: import('expo-av').AVPlaybackStatus) => {
    if (!status.isLoaded || !onProgress) return;
    onProgress(status.positionMillis, status.durationMillis ?? 0);
  }, [onProgress]);

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
        ref={webRef}
        src={near ? uri : undefined}
        poster={posterUri ?? undefined}
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          objectFit: 'contain', backgroundColor: '#000',
        }}
        autoPlay={isActive}
        loop
        muted={isMuted}
        playsInline
        controls={false}
        onTimeUpdate={(e) => {
          if (!onProgress) return;
          const el = e.currentTarget;
          onProgress(el.currentTime * 1000, Number.isFinite(el.duration) ? el.duration * 1000 : 0);
        }}
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
    <View style={[StyleSheet.absoluteFill, styles.frame, style]}>
      <Video
        ref={nativeRef}
        // Omitting source unloads the clip. src: https://github.com/expo/expo/blob/sdk-51/packages/expo-av/src/Video.types.ts · expo-av 14.0.7 · 2026-08-02
        source={near ? { uri } : undefined}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode?.CONTAIN}
        shouldPlay={isActive}
        isLooping
        isMuted={isMuted}
        usePoster
        posterSource={posterUri ? { uri: posterUri } : undefined}
        posterStyle={posterCover}
        progressUpdateIntervalMillis={250}
        onPlaybackStatusUpdate={onProgress ? handleStatus : undefined}
        onReadyForDisplay={() => setReady(true)}
      />
      {/* expo-av's own poster only covers its loading window. This one also
          covers the cells that have deliberately released their source. */}
      {posterUri && (!ready || !near) ? (
        <Image
          source={{ uri: posterUri }}
          contentFit="cover"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
    </View>
  );
}

const posterCover = { resizeMode: 'cover' } as const;

const styles = StyleSheet.create({
  frame: { backgroundColor: '#000', overflow: 'hidden' },
  unavailable: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  unavailableText: { color: 'rgba(255,255,255,0.6)', fontSize: 16 },
});
