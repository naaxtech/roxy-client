import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { BRAND_INK_INVERSE, RADII } from '../../lib/theme';
import { runSpring } from '../../lib/motion';
import { tapLight } from '../../lib/haptics';
import { a11yState } from '../../lib/a11yState';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

/**
 * The M3 switch, Roxy's one switch (design direction v2 › Settings).
 *
 * 52 × 32 track. On: `pink` track, white thumb at 20 dp that grows to 24 while
 * pressed. Off: `raised` track with a 2 dp `control` outline and a 16 dp
 * `control` thumb (also 24 while pressed). The thumb travels on
 * `SPRING.fastSpatial`; Reduce Motion makes it jump. A light haptic lands on
 * every change (haptics stay under Reduce Motion, per the direction).
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
  const [pressed, setPressed] = useState(false);
  const travel = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    runSpring(travel, value ? 1 : 0, 'fastSpatial', reducedMotion, false);
  }, [value, reducedMotion, travel]);

  const thumb = pressed && !disabled ? SWITCH.thumbPressed : value ? SWITCH.thumbOn : SWITCH.thumbOff;
  const centre = travel.interpolate({ inputRange: [0, 1], outputRange: [CENTER_OFF, CENTER_ON] });

  const toggle = () => {
    if (disabled) return;
    tapLight();
    onValueChange?.(!value);
  };

  return (
    <Pressable
      testID={testID}
      onPress={toggle}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      {...a11yState({ checked: value, disabled })}
      style={[s.target, disabled && s.disabled]}
    >
      <View
        testID={testID ? `${testID}-track` : undefined}
        style={[
          s.track,
          {
            backgroundColor: value ? colors.pink : colors.raised,
            borderColor: value ? colors.pink : colors.control,
          },
        ]}
      >
        <Animated.View
          testID={testID ? `${testID}-thumb` : undefined}
          pointerEvents="none"
          style={[
            s.thumb,
            {
              width: thumb,
              height: thumb,
              top: (INNER_H - thumb) / 2,
              marginStart: -thumb / 2,
              start: centre,
              backgroundColor: value ? BRAND_INK_INVERSE : colors.control,
            },
          ]}
        />
      </View>
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
    borderRadius: RADII.pill,
  },
});
