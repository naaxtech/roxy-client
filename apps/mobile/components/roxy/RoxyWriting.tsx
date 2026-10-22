import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPACE } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { RoxyO } from './RoxyO';

/** Her O beside the words, dp. */
export const WRITING_O = 24;

/** One squash cycle, ms: circle → squashed → stretched → circle. */
const CYCLE_MS = 1200;

/**
 * Roxy AI's writing indicator (design direction v2 › Shape: "the O squashing
 * circle → squircle → pill → circle", M3's loading-indicator idea in Roxy's
 * own shapes). Never a spinner. The O sits in `think` mood and squashes on a
 * loop on the native driver; Reduce Motion holds her still. The words say
 * what is happening, and a screen reader hears them once (polite region).
 */
export function RoxyWriting({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) return undefined;
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: CYCLE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, t]);

  const squash = reducedMotion
    ? { transform: [{ scaleX: 1 }, { scaleY: 1 }] }
    : {
        transform: [
          { scaleX: t.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [1, 1.18, 0.9, 1] }) },
          { scaleY: t.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [1, 0.82, 1.1, 1] }) },
        ],
      };

  return (
    <View testID={testID} style={s.row} accessibilityLiveRegion="polite" accessibilityLabel="Roxy AI is writing">
      <Animated.View testID={testID ? `${testID}-squash` : undefined} style={squash}>
        <RoxyO size={WRITING_O} mood="think" testID={testID ? `${testID}-o` : undefined} />
      </Animated.View>
      <Text style={[s.label, { color: colors.ink2 }]}>Roxy AI is writing</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE[1] },
  label: { ...TYPE.meta },
});
