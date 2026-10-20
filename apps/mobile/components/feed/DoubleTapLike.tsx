import { useCallback, useMemo, useRef } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { feedMediaTaps } from '../../lib/feedMediaTaps';
import { tapLight } from '../../lib/haptics';
import type { LikeBurstHandle } from './LikeBurst';

/**
 * Double-tap to like, on every kind of cell (FEED-07, FEED-09).
 *
 * The like moment used to exist on video only: a photo, a text card or a poll
 * could be liked only from the rail, so the gesture every member already knows
 * from Instagram and TikTok did nothing on most of the feed.
 *
 * Instagram's contract, kept on purpose: a double tap LIKES, and never takes a
 * like back. Unliking is the rail's job. That is why the double tap calls
 * `onDoubleTapLike` (an idempotent "make it liked") when the list provides one,
 * rather than toggling off a `liked` prop that can be a render stale: four
 * fast taps were two toggles, and the second one unliked.
 *
 * Every double tap blooms the ✿ and ticks a light haptic, liked already or
 * not, because the gesture deserves an answer either way.
 */
export function useDoubleTapLike({
  liked, onLike, onDoubleTapLike, reducedMotion,
}: {
  liked: boolean;
  onLike: () => void;
  onDoubleTapLike?: () => void;
  reducedMotion: boolean;
}): { burstRef: RefObject<LikeBurstHandle>; onDoubleTap: () => void } {
  const burstRef = useRef<LikeBurstHandle>(null);
  const onDoubleTap = useCallback(() => {
    if (onDoubleTapLike) onDoubleTapLike();
    else if (!liked) onLike();
    tapLight(reducedMotion);
    burstRef.current?.play();
  }, [liked, onLike, onDoubleTapLike, reducedMotion]);
  return { burstRef, onDoubleTap };
}

/** Two clicks this close together are a double click. Matches the native gesture. */
const WEB_DOUBLE_MS = 260;

/**
 * The transparent surface that hears the taps.
 *
 * Sits over the cell's body and under every control, so the rail, a poll
 * option or a link button keeps its own touches. With `children` it wraps them
 * (a photo gallery's horizontal pager), so a swipe through the photos still
 * reaches the pager and a double tap on a photo still likes it.
 *
 * Native uses RNGH with a 12dp slop, so a swipe is never a like. Web uses
 * click timing: RNGH's catcher captures the pointer there and the pager would
 * never see the drag.
 */
export function DoubleTapCatcher({
  onDoubleTap, onSingleTap, children, testID = 'feed-media-taps',
}: {
  onDoubleTap: () => void;
  /** Optional: a video pauses on a single tap; other cells do nothing. */
  onSingleTap?: () => void;
  children?: ReactNode;
  testID?: string;
}): ReactElement {
  const gesture = useMemo(
    () => feedMediaTaps(onDoubleTap, onSingleTap),
    [onDoubleTap, onSingleTap],
  );

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClick = useRef(0);

  if (Platform.OS === 'web') {
    const onClick = (): void => {
      const now = Date.now();
      if (now - lastClick.current < WEB_DOUBLE_MS) {
        lastClick.current = 0;
        if (pending.current) clearTimeout(pending.current);
        pending.current = null;
        onDoubleTap();
        return;
      }
      lastClick.current = now;
      if (!onSingleTap) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        onSingleTap();
      }, WEB_DOUBLE_MS);
    };
    return (
      <View
        testID={testID}
        style={StyleSheet.absoluteFill}
        collapsable={false}
        {...({ onClick } as Record<string, unknown>)}
      >
        {children}
      </View>
    );
  }

  return (
    <GestureDetector gesture={gesture} touchAction="pan-y">
      <View testID={testID} style={StyleSheet.absoluteFill} collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  );
}
