import { useCallback, useMemo, useRef } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { HEART, type PostReaction } from '../../lib/postReactions';
import { tapLight } from '../../lib/haptics';
import { reactionTaps, type TapPoint } from './reactionTaps';
import type { ReactionBurstHandle } from './ReactionBurst';

/**
 * Double tap = ❤️ on every kind of cell (direction v2 › Reactions). Replaces
 * the retired `components/feed/DoubleTapLike.tsx` (v0 like + ✿ bloom).
 *
 * Instagram's contract, kept: a double tap gives a heart and never takes a
 * reaction back. If she has already reacted (with anything) it adds nothing
 * and replays a smaller burst, so the gesture still answers. The haptic stays
 * under Reduce Motion (direction › Motion); the burst does not.
 */
export function useDoubleTapReact({
  reaction, onReact, reducedMotion,
}: {
  reaction: PostReaction | null;
  onReact: (next: PostReaction) => void;
  reducedMotion: boolean;
}): { burstRef: RefObject<ReactionBurstHandle>; onDoubleTap: (point: TapPoint) => void } {
  const burstRef = useRef<ReactionBurstHandle>(null);
  const onDoubleTap = useCallback((point: TapPoint) => {
    const already = reaction !== null;
    if (!already) onReact(HEART);
    tapLight(false);
    if (!reducedMotion) burstRef.current?.play(point, { small: already });
  }, [reaction, onReact, reducedMotion]);
  return { burstRef, onDoubleTap };
}

/** Two clicks this close together are a double click. Matches the native gesture. */
const WEB_DOUBLE_MS = 260;

type ClickEvent = {
  nativeEvent: { clientX: number; clientY: number };
  currentTarget: { getBoundingClientRect?: () => { left: number; top: number } };
};

/**
 * The transparent surface that hears the taps, over the body and under every
 * control. With `children` it wraps them (a photo gallery's horizontal pager),
 * so a swipe through the photos still reaches the pager.
 *
 * Native: gesture-handler with a 12 dp slop, so a swipe is never a reaction.
 * Web: click timing (gesture-handler's catcher would capture the pointer and
 * the pager would never see the drag), with the point read off the element.
 */
export function DoubleTapReact({
  onDoubleTap, onSingleTap, children, testID = 'feed-media-taps',
}: {
  onDoubleTap: (point: TapPoint) => void;
  /** Optional: a video pauses on a single tap; other cells do nothing. */
  onSingleTap?: () => void;
  children?: ReactNode;
  testID?: string;
}): ReactElement {
  const gesture = useMemo(() => reactionTaps(onDoubleTap, onSingleTap), [onDoubleTap, onSingleTap]);

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClick = useRef(0);

  if (Platform.OS === 'web') {
    const onClick = (e: ClickEvent): void => {
      const now = Date.now();
      if (now - lastClick.current < WEB_DOUBLE_MS) {
        lastClick.current = 0;
        if (pending.current) clearTimeout(pending.current);
        pending.current = null;
        const rect = e.currentTarget.getBoundingClientRect?.() ?? { left: 0, top: 0 };
        onDoubleTap({ x: e.nativeEvent.clientX - rect.left, y: e.nativeEvent.clientY - rect.top });
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
