import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Platform, RefreshControl, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useThemeColors } from '../../hooks/useThemeColors';
import { GESTURE, rubberBand, springTo } from '../../lib/motion';
import { LOADING_SIZES, LoadingO, useWaitVisible } from './RoxyLoading';

/**
 * Pull-to-refresh for the app AND roxy.expo.app (polish/motion-spec.md §1.3
 * rule 7, §3.1 row 7; decisions P1 faceless O, P3 threshold tick). Wave 3
 * lane C0; adopters B and D.
 *
 *   <RoxyRefresh refreshing={loading} onRefresh={reload} onThreshold={tick}>
 *     {(refreshControl) => <FlatList refreshControl={refreshControl} … />}
 *   </RoxyRefresh>
 *
 * - Native: the system RefreshControl, tinted `pink` on `surface` (the snap
 *   pager keeps the system control too, as the spec says). The system commits
 *   at its own threshold, so `onThreshold` runs right before `onRefresh`.
 * - Web (react-native-web's RefreshControl is an empty View): a touch pull on
 *   the list's own scroller, only from the top. It tracks 1:1 to
 *   `GESTURE.refreshThresholdDp` (72) and rubber-bands past it; the O scales
 *   0.6 → 1 with the pull; crossing the threshold calls `onThreshold` once per
 *   pull; releasing past it calls `onRefresh`; reversing below it first
 *   cancels. The browser's own overscroll / pull-to-reload is suppressed only
 *   while she is pulling. Mouse users are unaffected.
 * - The contained faceless O stays pinned while `refreshing` is true and at
 *   least `WAIT.minShowMs` (no flicker), then pops out. Keep `refreshing` true
 *   until the NEW content is on screen.
 * - Reduce Motion: the pull still follows the finger (she is moving it); the
 *   O does not morph; settles jump.
 *
 * testIDs: `<testID>` (web wrapper), `<testID>-indicator`, `<testID>-indicator-o`.
 */

/** 1:1 to the threshold, rubber band beyond (never past twice the threshold). */
export function pullDistance(dy: number, threshold: number = GESTURE.refreshThresholdDp): number {
  'worklet';
  if (dy <= 0) return 0;
  if (dy <= threshold) return dy;
  return threshold + rubberBand(dy - threshold, threshold);
}

export type PullController = {
  /** Touch down: `atTop` = the list is scrolled to its top. */
  start: (y: number, atTop: boolean) => void;
  /** Touch move. Returns true when the pull owns the move (call preventDefault). */
  move: (y: number, atTop: boolean) => boolean;
  end: () => void;
};

/** The web pull's state machine (pure; DOM wiring lives in the component). */
export function createPullController({
  threshold = GESTURE.refreshThresholdDp,
  onPull,
  onThreshold,
  onRelease,
}: {
  threshold?: number;
  onPull: (distance: number) => void;
  onThreshold?: () => void;
  onRelease: (armed: boolean) => void;
}): PullController {
  let tracking = false;
  let pulling = false;
  let crossed = false;
  let armed = false;
  let startY = 0;
  return {
    start(y, atTop) {
      tracking = atTop;
      pulling = false;
      crossed = false;
      armed = false;
      startY = y;
    },
    move(y, atTop) {
      if (!tracking) return false;
      const dy = y - startY;
      if (dy <= 0 || !atTop) {
        if (pulling) {
          pulling = false;
          armed = false;
          onPull(0);
        }
        if (!atTop) tracking = false;
        return false;
      }
      pulling = true;
      const distance = pullDistance(dy, threshold);
      onPull(distance);
      armed = distance >= threshold;
      if (armed && !crossed) {
        crossed = true;
        onThreshold?.();
      }
      return true;
    },
    end() {
      if (!tracking) return;
      tracking = false;
      const wasPulling = pulling;
      pulling = false;
      if (wasPulling) onRelease(armed);
      armed = false;
    },
  };
}

/** The scrollable element the touch started in (inside `root`), if any. */
function scrollerFor(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  let el = target as HTMLElement | null;
  while (el && el !== root.parentElement) {
    if (el.scrollHeight > el.clientHeight) {
      const overflow = window.getComputedStyle(el).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return el;
    }
    el = el.parentElement;
  }
  return null;
}

const animatable = typeof Reanimated?.createAnimatedComponent === 'function';
const AnimatedView = (animatable ? Reanimated.View : View) as unknown as typeof View;
const O = LOADING_SIZES.default.box;

export type RoxyRefreshProps = {
  refreshing: boolean;
  onRefresh: () => void;
  /** Once per pull, when it crosses the threshold (Lane E: `selection` haptic). */
  onThreshold?: () => void;
  /** Render the list; pass `refreshControl` to it (undefined on web). */
  children: (refreshControl: ReactElement | undefined) => ReactNode;
  /** `stage`: brandPink on the dark feed stage. */
  tone?: 'pink' | 'stage';
  /** Web wrapper style (default flex: 1). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function RoxyRefresh(props: RoxyRefreshProps) {
  return Platform.OS === 'web' ? <WebRefresh {...props} /> : <NativeRefresh {...props} />;
}

function NativeRefresh({ refreshing, onRefresh, onThreshold, children, tone = 'pink' }: RoxyRefreshProps) {
  const colors = useThemeColors();
  const tint = tone === 'stage' ? colors.brandPink : colors.pink;
  const handle = useCallback(() => {
    onThreshold?.();
    onRefresh();
  }, [onThreshold, onRefresh]);
  return (
    <>
      {children(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handle}
          tintColor={tint}
          colors={[tint]}
          progressBackgroundColor={colors.surface}
        />,
      )}
    </>
  );
}

function WebRefresh({
  refreshing,
  onRefresh,
  onThreshold,
  children,
  tone = 'pink',
  style,
  testID = 'roxy-refresh',
}: RoxyRefreshProps) {
  const reduced = useReducedMotion();
  const threshold = GESTURE.refreshThresholdDp;
  const pull = useSharedValue(0);
  const rootRef = useRef<View>(null);
  const held = useWaitVisible(refreshing, { delay: false });
  const heldRef = useRef(held);
  heldRef.current = held;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const onThresholdRef = useRef(onThreshold);
  onThresholdRef.current = onThreshold;

  const settle = useCallback(
    (to: number) => {
      // In: fastSpatial. Out: calm (0.1% overshoot), so the O never bounces back into view.
      pull.value = reduced ? to : withSpring(to, springTo(to > 0 ? 'fastSpatial' : 'calm', { px: true }));
    },
    [pull, reduced],
  );

  // Pinned while refreshing (and its 400 ms minimum); pops out after.
  useEffect(() => {
    settle(held ? threshold : 0);
  }, [held, settle, threshold]);

  useEffect(() => {
    const root = rootRef.current as unknown as HTMLElement | null;
    if (!root || typeof root.addEventListener !== 'function') return undefined;
    let scroller: HTMLElement | null = null;
    const atTop = () => !scroller || scroller.scrollTop <= 0;
    const controller = createPullController({
      threshold,
      onPull: (d) => {
        pull.value = d;
      },
      onThreshold: () => onThresholdRef.current?.(),
      onRelease: (armed) => {
        if (armed) {
          settle(threshold);
          onRefreshRef.current();
        } else {
          settle(0);
        }
      },
    });
    const onStart = (e: TouchEvent) => {
      if (heldRef.current || e.touches.length !== 1) return;
      scroller = scrollerFor(e.target, root);
      controller.start(e.touches[0].clientY, atTop());
    };
    const onMove = (e: TouchEvent) => {
      if (controller.move(e.touches[0].clientY, atTop()) && e.cancelable) e.preventDefault();
    };
    const onEnd = () => controller.end();
    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, [pull, settle, threshold]);

  const indicator = useAnimatedStyle(() => {
    const p = Math.min(pull.value / threshold, 1);
    return {
      // Fades over the first third of the pull: no flash from a sub-pixel settle.
      opacity: Math.min(Math.max(pull.value / (threshold / 3), 0), 1),
      transform: [{ translateY: pull.value - O }, { scale: 0.6 + 0.4 * p }],
    };
  });

  return (
    <View ref={rootRef} testID={testID} style={[styles.root, style]}>
      {children(undefined)}
      <AnimatedView
        testID={`${testID}-indicator`}
        pointerEvents="none"
        style={[styles.indicator, indicator] as StyleProp<ViewStyle>}
      >
        <LoadingO contained tone={tone} testID={`${testID}-indicator-o`} />
      </AnimatedView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  indicator: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
});
