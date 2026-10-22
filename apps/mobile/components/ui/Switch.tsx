import { useEffect } from 'react';
import { I18nManager, Pressable, StyleSheet } from 'react-native';
import Animated, {
  interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { BRAND_INK_INVERSE, RADII } from '../../lib/theme';
import { fadeConfig, headStart, springTo } from '../../lib/motion';
import { tapLight } from '../../lib/haptics';
import { a11yState } from '../../lib/a11yState';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { noPressDelay } from './noPressDelay';

/**
 * The M3 switch, Roxy's one switch (design direction v2 › Settings).
 *
 * 52 × 32 track. On: `pink` track, white thumb at 20 dp that grows to 24 while
 * pressed. Off: `raised` track with a 2 dp `control` outline and a 16 dp
 * `control` thumb (also 24 while pressed). The thumb travels on
 * `SPRING.fastSpatial`; Reduce Motion makes it jump. A light haptic lands on
 * every change (haptics stay under Reduce Motion, per the direction).
 *
 * Motion runs on the UI thread (Wave 3, motion spec §3.1 row 2): travel,
 * size and colour are shared values, so press-in grows the thumb without a
 * React render and a busy JS thread cannot hold the travel back. The track
 * and thumb colours cross-fade on `SPRING.fastEffects` (never a snap; Reduce
 * Motion: a 120 ms fade). The thumb is one 24 dp disc scaled to 16 / 20 / 24
 * and moved by a transform, so nothing relayouts while it moves.
 *
 * Same props as React Native's `Switch` (`value`, `onValueChange`, `disabled`)
 * so a call site swaps one import. The control is a real 48 dp target and a
 * real `switch` for assistive technology (`aria-checked` on the web).
 *
 * Why not RN's `Switch`: its track and thumb sizes are fixed per platform and
 * the web build draws a browser checkbox-like control, so neither the v2 shape
 * nor the outline-off state can be drawn with it.
 */
export const SWITCH = {
  width: 52,
  height: 32,
  outline: 2,
  thumbOff: 16,
  thumbOn: 20,
  thumbPressed: 24,
} as const;

/** The thumb's centre, inside the outline, at each end of the track. */
const INNER_H = SWITCH.height - 2 * SWITCH.outline;
const INNER_W = SWITCH.width - 2 * SWITCH.outline;
const CENTER_OFF = INNER_H / 2;
const CENTER_ON = INNER_W - INNER_H / 2;
/** The thumb is drawn at its pressed size and scaled down. */
const THUMB_BOX = SWITCH.thumbPressed;

export type SwitchProps = {
  value: boolean;
  onValueChange?: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

export function Switch({
  value, onValueChange, disabled = false, accessibilityLabel, accessibilityHint, testID,
}: SwitchProps) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  /** 0 off → 1 on: the thumb's travel (spatial) … */
  const travel = useSharedValue(value ? 1 : 0);
  /** … and the colours (effects: no overshoot). */
  const tint = useSharedValue(value ? 1 : 0);
  /** 1 while pressed: the thumb grows to 24 dp. */
  const press = useSharedValue(0);
  const rtl = I18nManager.isRTL;

  useEffect(() => {
    const to = value ? 1 : 0;
    if (reducedMotion) {
      travel.value = to;
      tint.value = withTiming(to, fadeConfig());
    } else {
      travel.value = withSpring(to, springTo('fastSpatial'));
      tint.value = withSpring(to, springTo('fastEffects'));
    }
  }, [value, reducedMotion, travel, tint]);

  const pressTo = (to: number) => {
    if (disabled) return;
    if (reducedMotion) {
      press.value = to;
    } else if (to === 1 && press.value <= 0.001) {
      // From rest: leave one frame into the spring (F1, painted next frame).
      const { start, config } = headStart(0, 1);
      press.value = start;
      press.value = withSpring(1, config);
    } else {
      press.value = withSpring(to, springTo('fastSpatial'));
    }
  };

  const off = { track: colors.raised, border: colors.control, thumb: colors.control };
  const on = { track: colors.pink, border: colors.pink, thumb: BRAND_INK_INVERSE };

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(tint.value, [0, 1], [off.track, on.track]),
    borderColor: interpolateColor(tint.value, [0, 1], [off.border, on.border]),
  }), [off.track, on.track, off.border, on.border]);

  const thumbStyle = useAnimatedStyle(() => {
    const centre = CENTER_OFF + travel.value * (CENTER_ON - CENTER_OFF);
    const rest = SWITCH.thumbOff + tint.value * (SWITCH.thumbOn - SWITCH.thumbOff);
    const size = rest + press.value * (SWITCH.thumbPressed - rest);
    return {
      backgroundColor: interpolateColor(tint.value, [0, 1], [off.thumb, on.thumb]),
      transform: [
        { translateX: (rtl ? INNER_W - centre : centre) - THUMB_BOX / 2 },
        { scale: size / THUMB_BOX },
      ],
    };
  }, [off.thumb, on.thumb, rtl]);

  const toggle = () => {
    if (disabled) return;
    tapLight();
    onValueChange?.(!value);
  };

  return (
    <Pressable
      testID={testID}
      onPress={toggle}
      onPressIn={() => pressTo(1)}
      onPressOut={() => pressTo(0)}
      {...noPressDelay()}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      {...a11yState({ checked: value, disabled })}
      style={[s.target, disabled && s.disabled]}
    >
      <Animated.View testID={testID ? `${testID}-track` : undefined} style={[s.track, trackStyle]}>
        <Animated.View
          testID={testID ? `${testID}-thumb` : undefined}
          pointerEvents="none"
          style={[s.thumb, thumbStyle]}
        />
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  target: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.38 },
  track: {
    width: SWITCH.width,
    height: SWITCH.height,
    borderRadius: RADII.pill,
    borderWidth: SWITCH.outline,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    top: (INNER_H - THUMB_BOX) / 2,
    width: THUMB_BOX,
    height: THUMB_BOX,
    borderRadius: RADII.pill,
  },
});
