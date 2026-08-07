import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { FeedVideoPlayer } from './FeedVideoPlayer';
import { FeedCellChrome } from './FeedCellChrome';
import type { FeedCellChromeProps } from './FeedCellChrome';
import { CHROME_SHADOW, RAIL_BACKING } from './feedChromeTokens';

export interface ReelCellProps
  extends Omit<FeedCellChromeProps, 'playbackControl' | 'showCaption' | 'active'> {
  /**
   * This cell's position in the list. Drives the decoder window ONLY — distance
   * from the active cell is inherently positional. It must never decide
   * playback: see `activeItemId`.
   */
  index: number;
  /** The active cell's position, for the same distance maths. */
  activeIndex: number;
  /**
   * The id of the item the pager is currently on.
   *
   * Playback keys on this rather than on `index === activeIndex`, because a bare
   * index carries no identity and no type. The pager is mixed-media, so an index
   * match would cheerfully tell a photo, a poll or a game cell to start playing;
   * and an index is stale the moment a page is spliced in ahead of this cell,
   * which `ReelsFeed.load` does whenever a viewer arrives on a specific video.
   * An id survives both.
   */
  activeItemId: string | null;
  width: number;
  height: number;
  muted: boolean;
  onToggleMute: () => void;
}

/**
 * The video cell.
 *
 * Owns the video surface and nothing else a viewer would recognise as chrome:
 * the rail, the crest, the scrim and the identity block are `FeedCellChrome`,
 * shared with every other kind of cell, so a video and a poll are furnished
 * identically and the feed reads as one system. What is left here is the part
 * that is genuinely about video — the player, the tap-to-pause gesture, the
 * double-tap like, the mute toggle and the transport control.
 */
export function ReelCell({
  post, index, activeIndex, activeItemId, width, height,
  muted, reducedMotion, liked, onToggleMute, onLike,
  ...chrome
}: ReelCellProps): ReactElement {
  const isActive = post.id === activeItemId;
  const isVideo = post.post_type === 'video';

  // Reduce Motion turns autoplay off: WCAG 2.2 SC 2.2.2 treats a clip running
  // past five seconds as moving content that needs a pause mechanism, and a
  // viewer who asked the OS for less motion has already answered that.
  const autoplay = !reducedMotion;
  // null = follow the mode's default; true/false = the viewer tapped.
  const [playOverride, setPlayOverride] = useState<boolean | null>(null);
  // Two independent conditions, both required: this cell is the one being
  // looked at, AND this cell is something that plays.
  const playing = isActive && isVideo && (playOverride ?? autoplay);

  // A cell scrolled away from is a cell whose pause was about the old clip;
  // recycled or returned to, it should behave like a fresh one.
  useEffect(() => {
    if (!isActive) setPlayOverride(null);
  }, [isActive]);

  const burst = useSharedValue(0);
  const burstStyle = useAnimatedStyle(() => ({
    opacity: burst.value,
    transform: [{ scale: 0.7 + burst.value * 0.45 }],
  }));

  const handleDoubleTap = useCallback(() => {
    // Instagram's contract: a double tap likes, and a second double tap does
    // not take it back. Unliking is the rail button's job.
    if (!liked) onLike();
    if (reducedMotion) return;
    burst.value = withSequence(
      withTiming(1, { duration: 160 }),
      withDelay(340, withTiming(0, { duration: 240 })),
    );
  }, [liked, onLike, reducedMotion, burst]);

  const togglePlay = useCallback(() => {
    setPlayOverride((prev) => !(prev ?? autoplay));
  }, [autoplay]);

  // runOnJS(true) keeps these callbacks off the UI thread so they can touch
  // React state and the Zustand store directly.
  // "when `true`, all the callbacks will be run on the JS thread instead of the
  // UI thread, regardless of whether they are worklets or not." The versioned
  // docs.swmansion.com path for 2.16.2 now 404s, so this cites the tag.
  // src: https://github.com/software-mansion/react-native-gesture-handler/blob/2.16.2/src/handlers/gestures/gesture.ts · react-native-gesture-handler 2.16.2 · 2026-08-05
  const tapGesture = useMemo(() => {
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(260)
      .runOnJS(true)
      .onEnd((_event, success) => { if (success) handleDoubleTap(); });
    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .runOnJS(true)
      .onEnd((_event, success) => { if (success) togglePlay(); });
    // Exclusive, not Race: the single tap must wait for the double tap to fail,
    // or every like also pauses the video.
    return Gesture.Exclusive(doubleTap, singleTap);
  }, [handleDoubleTap, togglePlay]);

  /**
   * The pause mechanism WCAG 2.2 SC 2.2.2 requires. Tap-anywhere does the same
   * thing but is invisible to a screen reader.
   *
   * It hangs above the shared rail rather than inside it: the rail's five slots
   * are the social actions every cell has, and a control that exists on one
   * cell type would move the other four's icons under a viewer's thumb.
   */
  const transport = isVideo ? (
    <TouchableOpacity
      testID="reel-transport"
      style={s.transportBtn}
      onPress={togglePlay}
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Pause video' : 'Play video'}
    >
      <Ionicons name={playing ? 'pause' : 'play'} size={22} color="#fff" style={CHROME_SHADOW} />
    </TouchableOpacity>
  ) : undefined;

  return (
    <View testID="reel-cell" style={[s.page, { width, height }]}>
      <FeedVideoPlayer
        videoUrl={post.video_url}
        posterUrl={post.video_thumbnail_url}
        postId={post.id}
        isActive={playing}
        isMuted={muted}
        index={index}
        activeIndex={activeIndex}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Transparent catcher: sits over the video and under every control, so
          the rail buttons keep their own touches. */}
      <GestureDetector gesture={tapGesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false} />
      </GestureDetector>

      <Animated.View style={[s.burst, burstStyle]} pointerEvents="none">
        <Ionicons name="heart" size={110} color="rgba(255,255,255,0.92)" />
      </Animated.View>

      {isVideo && isActive && !playing ? (
        <View
          style={s.pausedGlyph}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons name="play" size={64} color="rgba(255,255,255,0.85)" />
        </View>
      ) : null}

      {isVideo ? (
        <TouchableOpacity
          testID="reel-mute"
          style={s.muteBtn}
          onPress={onToggleMute}
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
          accessibilityState={{ selected: !muted }}
        >
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={18} color="#fff" />
        </TouchableOpacity>
      ) : null}

      <FeedCellChrome
        post={post}
        liked={liked}
        reducedMotion={reducedMotion}
        onLike={onLike}
        active={isActive}
        playbackControl={transport}
        {...chrome}
      />
    </View>
  );
}

// Static: the reel surface is white-on-video everywhere, so it never reads the
// theme, and rebuilding this per cell would allocate on every swipe.
const s = StyleSheet.create({
  page: { backgroundColor: '#000' },
  burst: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedGlyph: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Both sit over media the app has never seen and neither is inside the
  // bottom scrim, so both carry the rail's plate rather than a lighter one of
  // their own: at 0.4 a white glyph over a white frame is 2.85:1, under the 3:1
  // that SC 1.4.11 asks of a control.
  // Both were sized to their glyph (40 and 38) and then given 8dp of hitSlop,
  // which extends nothing a platform can measure. They are 48 now, which is what
  // ATF's TouchTargetSizeCheck asks of a control. src: lib/touchTargets.ts
  transportBtn: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: RAIL_BACKING,
  },
  muteBtn: {
    position: 'absolute', top: 16, right: 14,
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: RAIL_BACKING,
  },
});
