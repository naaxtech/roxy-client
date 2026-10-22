import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { MOTION, RADII, SPACE } from '../../lib/theme';

/** The LIVE dot's low point (direction › Motion: `MOTION.pulse` 1 → 0.4). */
const PULSE_LOW = 0.4;

/**
 * The LIVE dot (design direction v2 › Color, Motion): a flat `live` dot that
 * pulses 1 → 0.4 over `MOTION.pulse`, always next to the word "LIVE" — colour
 * alone never says live (WCAG 1.4.1). Reduce Motion: a steady dot.
 */
export function LiveDot({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      return undefined;
    }
    const half = MOTION.pulse / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: PULSE_LOW, duration: half, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: half, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, opacity]);

  return (
    <Animated.View
      testID={testID}
      style={[s.dot, { backgroundColor: colors.live, opacity }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

const s = StyleSheet.create({
  dot: { width: SPACE[1], height: SPACE[1], borderRadius: RADII.pill },
});
