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
 * There is no number this code can read at runtime. Android publishes a
 * per-codec ceiling through `CodecCapabilities.getMaxSupportedInstances()`,
 * whose own javadoc calls it "a hint for an upper bound. Applications should not
 * expect to successfully operate more instances than the returned value, but the
 * actual number of concurrently operable instances may be less as it depends on
 * the available resources at time of use." OEMs set that ceiling per codec in
 * `/etc/media_codecs.xml` (`<Limit name="concurrent-instances">`), expo-av
 * 14.0.7 exposes no API for reading it, and the one figure the compatibility
 * spec fixes — six concurrent 8-bit hardware decoder sessions — is a Media
 * Performance Class requirement, so it is a floor for MPC devices and a promise
 * about nothing on everything else.
 *
 * So the window is chosen small rather than tuned. 1 means three live decoders
 * at most — previous, active, next — which keeps a swipe in either direction
 * landing on a decoded frame while staying far inside any plausible ceiling.
 *
 * src: https://developer.android.com/reference/android/media/MediaCodecInfo.CodecCapabilities#getMaxSupportedInstances() · 2026-08-05
 * src: https://android.googlesource.com/platform/frameworks/base/+/master/media/java/android/media/MediaCodecInfo.java · the javadoc quoted above · 2026-08-05
 * src: https://source.android.com/docs/core/media/oem · concurrent-instances in media_codecs.xml · 2026-08-05
 * src: https://source.android.com/docs/compatibility/15/android-15-cdd · media performance class · 2026-08-05
 */
const DECODER_WINDOW = 1;

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
  /**
   * The post this clip belongs to. Keys the poster's recycling so a reused cell
   * never shows the previous post's photo. Omit outside a recycled list.
   */
  postId?: string | null;
  /** This cell's position in the list. Omit outside a list. */
  index?: number;
  /** The list's active cell. Omit outside a list. */
  activeIndex?: number;
  /** Playback progress, for a scrub/progress bar. Only fires while active. */
  onProgress?: (positionMillis: number, durationMillis: number) => void;
}

export function FeedVideoPlayer({
  videoUrl, isActive, isMuted, style, posterUrl, postId, index, activeIndex, onProgress,
}: Props) {
  const uri = getVideoPlaybackUrl(videoUrl);
  const posterUri = posterUrl ? getPostImageUrl(posterUrl, 'detail') : null;
  const nativeRef = useRef<AvVideoInstance | null>(null);
  const webRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);

  // Cells outside the window unmount their player so the active video always
  // gets a decoder. `index`/`activeIndex` omitted (single-video screens) means
  // "always near" — there is nothing to compete with.
  const near =
    index == null || activeIndex == null || Math.abs(index - activeIndex) <= DECODER_WINDOW;

  // A recycled cell shows the previous clip's last frame until the new one
  // decodes; forget readiness whenever the clip changes — or whenever the player
  // is rebuilt, because a fresh instance has decoded nothing yet.
  useEffect(() => { setReady(false); }, [uri, near]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const el = webRef.current;
      if (!el) return;
      if (isActive) void el.play().catch(() => { /* autoplay policy — poster stays */ });
      else el.pause();
      return;
    }
    const player = nativeRef.current;
    // Null while this cell is outside the window: there is no player to drive.
    if (!player) return;
    // Note this pauses only — `pauseAsync()` is documented as exactly
    // `setStatusAsync({ shouldPlay: false })`, so it frees no decoder. Release
    // is the unmount's job, below.
    // src: https://github.com/expo/expo/blob/sdk-51/packages/expo-av/src/AV.ts · expo-av 14.0.7 · 2026-08-05
    if (isActive) void player.playAsync().catch(() => { /* not loaded yet */ });
    else void player.pauseAsync().catch(() => { /* not loaded yet */ });
  }, [isActive, near]);

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

  /**
   * The still that stands in for a player.
   *
   * `recyclingKey` is what stops a recycled cell rendering the previous post's
   * photo while this one loads: "Changing this prop resets the image view
   * content to blank or a placeholder before loading and rendering the final
   * image. This is especially useful for any kinds of recycling views like
   * FlashList to prevent showing the previous source before the new one fully
   * loads."
   * src: https://github.com/expo/expo/blob/sdk-51/packages/expo-image/src/Image.types.ts · expo-image 1.13.0 · 2026-08-05
   */
  const posterOverlay = posterUri ? (
    <Image
      testID="feed-video-poster"
      source={{ uri: posterUri }}
      contentFit="cover"
      recyclingKey={postId ?? posterUri}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  ) : null;

  if (Platform.OS === 'web') {
    return (
      <View style={[StyleSheet.absoluteFill, styles.frame, style]}>
        {near ? (
          <video
            ref={webRef}
            src={uri}
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
        ) : null}
        {/* The element's own `poster` attribute covers its loading window, so
            this only has to cover the cells that released their player. */}
        {near ? null : posterOverlay}
      </View>
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
      {/*
        Out-of-window cells UNMOUNT the player. They do NOT blank its `source`,
        because blanking the source frees nothing:

          - `Video` declares exactly one lifecycle method, `componentWillUnmount`,
            and that is the only place it calls `unloadAsync()`. There is no
            `componentDidUpdate`, so changing `source` never unloads anything.
          - On Android the prop is declared non-nullable —
            `Prop("source") { view: VideoViewWrapper, source: ReadableMap -> ... }`
            — and `VideoView#setSource` returns early on a null uri
            (`if (uriString == null) { promise.resolve(getUnloadedStatus()); return; }`)
            without ever reaching `mPlayerData.release()`.
          - `Video.types.ts` claims only that a null source makes the component
            "display nothing" — display, not release.

        Unmounting takes both release paths at once: `componentWillUnmount` →
        `unloadAsync()` → `ExponentAV.unloadForVideo(tag)` in JS, and
        `OnViewDestroys` → `onDropViewInstance()` →
        `unloadPlayerAndMediaController()` → `mPlayerData.release()` natively.

        src: https://github.com/expo/expo/blob/sdk-51/packages/expo-av/src/Video.tsx · expo-av 14.0.7 · 2026-08-05
        src: https://github.com/expo/expo/blob/sdk-51/packages/expo-av/android/src/main/java/expo/modules/av/video/VideoViewModule.kt · 2026-08-05
        src: https://github.com/expo/expo/blob/sdk-51/packages/expo-av/android/src/main/java/expo/modules/av/video/VideoView.java · 2026-08-05
      */}
      {near ? (
        <Video
          ref={nativeRef}
          source={{ uri }}
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
      ) : null}
      {/* expo-av's own poster only covers its loading window. This one also
          covers the cells that have released their player entirely. */}
      {!ready || !near ? posterOverlay : null}
    </View>
  );
}

const posterCover = { resizeMode: 'cover' } as const;

const styles = StyleSheet.create({
  frame: { backgroundColor: '#000', overflow: 'hidden' },
  unavailable: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  unavailableText: { color: 'rgba(255,255,255,0.6)', fontSize: 16 },
});
