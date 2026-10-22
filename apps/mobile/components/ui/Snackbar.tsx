import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { MARGIN, RADII, SPACE, floatElevation } from '../../lib/theme';
import { runSpring } from '../../lib/motion';
import { TYPE, emphasized } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { TouchableOpacity } from './PressableScale';

/** How long a snackbar stays (ms): the direction's "Undo for 6 seconds". */
export const SNACKBAR_DURATION = 6000;

/** How far below its resting place it springs in from (dp). */
const ENTER_FROM = SPACE[5];

export type SnackbarProps = {
  visible: boolean;
  /** One sentence. */
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Called when it leaves: after `duration`, or after the action. */
  onDismiss: () => void;
  duration?: number;
  /** Distance from the bottom of its parent (dp). */
  bottom?: number;
  testID?: string;
};

/**
 * The snackbar (design direction v2): `inverse` surface, `onInverse` text, an
 * `inversePink` action, radius 20, the `float` elevation (it floats, so it may
 * cast the one shadow). It springs in on `SPRING.spatial` (Reduce Motion: it
 * simply appears), stays `SNACKBAR_DURATION` and leaves by itself. Announced
 * politely to screen readers. No confirm, no guilt: one sentence, one action.
 *
 * Render it inside the screen it belongs to (absolute, over the content), not
 * in a Modal: it must never block the screen behind it.
 */
export function Snackbar({
  visible, message, actionLabel, onAction, onDismiss, duration = SNACKBAR_DURATION, bottom = MARGIN, testID,
}: SnackbarProps) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!visible) {
      enter.setValue(0);
      return undefined;
    }
    runSpring(enter, 1, 'spatial', reducedMotion);
    const t = setTimeout(() => dismissRef.current(), duration);
    return () => clearTimeout(t);
  }, [visible, message, duration, reducedMotion, enter]);

  if (!visible) return null;

  return (
    <Animated.View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        s.bar,
        floatElevation(colors),
        {
          bottom,
          backgroundColor: colors.inverse,
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [ENTER_FROM, 0] }) }],
        },
      ]}
    >
      <Text style={[s.message, { color: colors.onInverse }]}>{message}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity
          testID={testID ? `${testID}-action` : undefined}
          onPress={() => {
            onAction();
            onDismiss();
          }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={s.action}
        >
          <Text style={[s.actionLabel, { color: colors.inversePink }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </Animated.View>
  );
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
