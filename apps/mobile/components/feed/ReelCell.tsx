import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { View, StyleSheet } from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { FeedVideoPlayer } from './FeedVideoPlayer';
import { FeedCellChrome } from './FeedCellChrome';
import { DoubleTapReact, useDoubleTapReact } from '../reactions/DoubleTapReact';
import { ReactionBurst } from '../reactions/ReactionBurst';
import { OutlinedIcon } from './RailGlyph';
import type { FeedCellChromeProps } from './FeedCellChrome';
import { RAIL_GAP } from './feedChromeTokens';
import { a11yState } from '../../lib/a11yState';

/** The mute / play glyphs: a step under the rail's 32 dp, they are secondary. */
const CONTROL_GLYPH = 24;
/** The paused-video glyph in the middle of the frame. */
const PAUSED_GLYPH = 64;

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
  /**
   * False while the screen is blurred or the app is backgrounded. Tabs keep
   * their screens mounted, so without this a clip played on, with sound,
   * behind Messages or a pushed profile (FEED-03). Defaults to true.
   */
  playbackAllowed?: boolean;
}

/**
 * The video cell.
 *
 * Owns the video surface and nothing else a viewer would recognise as chrome:
 * the rail, the scrim and the identity block are `FeedCellChrome`,
 * shared with every other kind of cell, so a video and a poll are furnished
 * identically and the feed reads as one system. What is left here is the part
 * that is genuinely about video — the player, the tap-to-pause gesture, the
 * double-tap reaction, the mute toggle and the transport control.
 */
export function ReelCell({
  post, index, activeIndex, activeItemId, width, height,
  muted, reducedMotion, onToggleMute, playbackAllowed = true,
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
  // The screen being on screen is a third: a tap-to-play override never
  // outranks a blurred tab or a backgrounded app.
  const playing = isActive && isVideo && playbackAllowed && (playOverride ?? autoplay);

  // A cell scrolled away from is a cell whose pause was about the old clip;
  // recycled or returned to, it should behave like a fresh one.
  useEffect(() => {
    if (!isActive) setPlayOverride(null);
  }, [isActive]);

  // Double tap = ❤️ (never takes a reaction back) with the burst and a light
  // haptic — the same hook every other cell type uses, so the gesture means
  // one thing.
  const { burstRef, onDoubleTap } = useDoubleTapReact({
    reaction: chrome.reaction, onReact: chrome.onReact, reducedMotion,
  });

  const togglePlay = useCallback(() => {
    setPlayOverride((prev) => !(prev ?? autoplay));
  }, [autoplay]);

  /**
   * The pause mechanism WCAG 2.2 SC 2.2.2 requires. Tap-anywhere does the same
   * thing but is invisible to a screen reader.
   *
   * It hangs above the shared rail rather than inside it: the rail's five slots
   * are the social actions every cell has, and a control that exists on one
   * cell type would move the other four's icons under a viewer's thumb.
   */
  const transport = isVideo ? (
    <View style={s.controls} pointerEvents="box-none">
      <TouchableOpacity
        testID="reel-mute"
        style={s.controlBtn}
        onPress={onToggleMute}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
        {...a11yState({ selected: !muted })}
      >
        <OutlinedIcon name={muted ? 'volume-mute' : 'volume-high'} size={CONTROL_GLYPH} />
      </TouchableOpacity>
      <TouchableOpacity
        testID="reel-transport"
        style={s.controlBtn}
        onPress={togglePlay}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause video' : 'Play video'}
      >
        <OutlinedIcon name={playing ? 'pause' : 'play'} size={CONTROL_GLYPH} />
      </TouchableOpacity>
    </View>
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
          the rail buttons keep their own touches. A single tap pauses. */}
      <DoubleTapReact onDoubleTap={onDoubleTap} onSingleTap={togglePlay} />

      <ReactionBurst ref={burstRef} reducedMotion={reducedMotion} />

      {isVideo && isActive && !playing ? (
        <View
          style={s.pausedGlyph}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <OutlinedIcon name="play" size={PAUSED_GLYPH} />
        </View>
      ) : null}

      <FeedCellChrome
        post={post}
        reducedMotion={reducedMotion}
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
  pausedGlyph: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // v2: the mute and play controls sit in the rail column, above the rail,
  // plate-less like every rail glyph (drawn 1 dp outline, `RailGlyph`). The
  // mute used to float at top 16 / end 14, under the Feed header's search
  // button, where the header (drawn over the pager) took its taps.
  // 48 dp targets (ATF TouchTargetSizeCheck; lib/touchTargets.ts).
  controls: { gap: RAIL_GAP, alignItems: 'center' },
  controlBtn: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center',
  },
});
