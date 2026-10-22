import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { MARGIN, RADII, SPACE, floatElevation } from '../../lib/theme';
import { GESTURE, projectRelease, springTo } from '../../lib/motion';
import { TYPE, emphasized } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { TouchableOpacity } from './PressableScale';

/** How long a snackbar stays (ms): the direction's "Undo for 6 seconds". */
export const SNACKBAR_DURATION = 6000;

/**
 * After a dismissing swipe, how long the fly-off has before the snackbar
 * leaves the tree (ms). A fixed wait, never the spring's completion callback
 * (pixel springs report "finished" long after they look done).
 */
export const SNACKBAR_SWIPE_EXIT_MS = 220;

/** How far below its resting place it springs in from (dp). */
const ENTER_FROM = SPACE[5];
/** A drag fades it toward this opacity at a full width away. */
const DRAG_FADE = 0.6;

export type SnackbarProps = {
  visible: boolean;
  /** One sentence. */
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Called when it leaves: after `duration`, after the action, or after a swipe. */
  onDismiss: () => void;
  duration?: number;
  /** Distance from the bottom of its parent (dp). */
  bottom?: number;
  testID?: string;
};

// Suites that mock RNGH partially get a snackbar without the swipe.
const canPan = typeof Gesture?.Pan === 'function' && typeof GestureDetector === 'function';

const DISMISS_ACTIONS = [{ name: 'dismiss', label: 'Dismiss' }, { name: 'escape' }];

/**
 * The snackbar (design direction v2): `inverse` surface, `onInverse` text, an
 * `inversePink` action, radius 20, the `float` elevation (it floats, so it may
 * cast the one shadow). It springs in on `SPRING.spatial` (Reduce Motion: it
 * simply appears), stays `SNACKBAR_DURATION` and leaves by itself. Announced
 * politely to screen readers. No confirm, no guilt: one sentence, one action.
 *
 * Wave 3 (motion spec §3.1 row 13, lane C): everything runs on reanimated
 * shared values, and it can be swiped away sideways (M3). The drag follows
 * the finger on the UI thread (RNGH Pan) and fades it a little; the release
 * uses the projected position (WWDC18): past `GESTURE.dismissFraction` of its
 * width, or a fling over `GESTURE.flingDpPerS`, it flies off that way and
 * leaves `SNACKBAR_SWIPE_EXIT_MS` later; otherwise it springs home. Its timer
 * pauses while it is held and starts over when it is let go. Reduce Motion:
 * no travel. Screen readers get a Dismiss action instead of the swipe.
 *
 * Render it inside the screen it belongs to (absolute, over the content), not
 * in a Modal: it must never block the screen behind it.
 */
export function Snackbar({
  visible, message, actionLabel, onAction, onDismiss, duration = SNACKBAR_DURATION, bottom = MARGIN, testID,
}: SnackbarProps) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  /** 0 → 1: the entrance (rise + fade). */
  const enter = useSharedValue(0);
  /** The sideways drag (dp). */
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gone = useRef(false);

  const stopTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const startTimer = useCallback(() => {
    stopTimer();
    timer.current = setTimeout(() => dismissRef.current(), duration);
  }, [duration, stopTimer]);

  useEffect(() => {
    if (!visible) {
      enter.value = 0;
      x.value = 0;
      return undefined;
    }
    gone.current = false;
    x.value = 0;
    enter.value = reducedMotion ? 1 : withSpring(1, springTo('spatial'));
    startTimer();
    return stopTimer;
  }, [visible, message, duration, reducedMotion, enter, x, startTimer, stopTimer]);

  const leave = useCallback((afterMs: number) => {
    if (gone.current) return;
    gone.current = true;
    stopTimer();
    if (afterMs <= 0) dismissRef.current();
    else timer.current = setTimeout(() => dismissRef.current(), afterMs);
  }, [stopTimer]);
  const swipedAway = useCallback(() => leave(reducedMotion ? 0 : SNACKBAR_SWIPE_EXIT_MS), [leave, reducedMotion]);

  const pan = canPan
    ? Gesture.Pan()
        .withTestId(`${testID ?? 'snackbar'}-pan`)
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onStart(() => {
          runOnJS(stopTimer)();
        })
        .onUpdate((e) => {
          x.value = e.translationX;
        })
        .onEnd((e) => {
          const w = width.value > 0 ? width.value : 320;
          const projected = projectRelease(x.value, e.velocityX);
          const away = Math.abs(projected) > w * GESTURE.dismissFraction || Math.abs(e.velocityX) > GESTURE.flingDpPerS;
          if (away) {
            const dir = (projected === 0 ? e.velocityX : projected) < 0 ? -1 : 1;
            x.value = reducedMotion
              ? dir * w
              : withSpring(dir * (w + MARGIN * 2), springTo('fastSpatial', { px: true, velocity: e.velocityX }));
            runOnJS(swipedAway)();
          } else {
            x.value = reducedMotion ? 0 : withSpring(0, springTo('fastSpatial', { px: true, velocity: e.velocityX }));
            runOnJS(startTimer)();
          }
        })
    : null;

  const barStyle = useAnimatedStyle(() => {
    const w = width.value > 0 ? width.value : 320;
    const drag = Math.min(Math.abs(x.value) / w, 1);
    return {
      opacity: enter.value * (1 - DRAG_FADE * drag),
      transform: [{ translateX: x.value }, { translateY: (1 - enter.value) * ENTER_FROM }],
    };
  });

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    width.value = e.nativeEvent.layout.width;
  }, [width]);

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === 'dismiss' || name === 'escape') leave(0);
  };

  if (!visible) return null;

  const bar = (
    <Reanimated.View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityActions={DISMISS_ACTIONS}
      onAccessibilityAction={onAccessibilityAction}
      onLayout={onLayout}
      style={[s.bar, floatElevation(colors), { bottom, backgroundColor: colors.inverse }, barStyle]}
    >
      <Text style={[s.message, { color: colors.onInverse }]}>{message}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity
          testID={testID ? `${testID}-action` : undefined}
          onPress={() => {
            onAction();
            leave(0);
          }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={s.action}
        >
          <Text style={[s.actionLabel, { color: colors.inversePink }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </Reanimated.View>
  );

  return pan ? <GestureDetector gesture={pan}>{bar}</GestureDetector> : bar;
}

const s = StyleSheet.create({
  bar: {
    position: 'absolute',
    start: MARGIN,
    end: MARGIN,
    minHeight: MIN_TOUCH_TARGET + SPACE[1],
    borderRadius: RADII.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingStart: MARGIN,
    paddingEnd: SPACE[1],
    gap: SPACE[1],
  },
  message: { ...TYPE.body, flex: 1, paddingVertical: SPACE[2] },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADII.pill,
  },
  actionLabel: { ...emphasized('label') },
});
