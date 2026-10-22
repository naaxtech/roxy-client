import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  Easing, ReduceMotion, cancelAnimation, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPACE } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { RoxyO } from './RoxyO';
import { LOADING_CYCLE_MS } from '../feedback/RoxyLoading';

/** Her O beside the words, dp. */
export const WRITING_O = 24;

const STOPS = [0, 0.33, 0.66, 1];
const SCALE_X = [1, 1.18, 0.9, 1];
const SCALE_Y = [1, 0.82, 1.1, 1];
// Suites that mock reanimated partially get a still O.
const canLoop = typeof withRepeat === 'function' && typeof Reanimated?.createAnimatedComponent === 'function';
const SquashView = (canLoop ? Reanimated.View : View) as unknown as typeof View;

/**
 * Roxy AI's writing indicator (design direction v2 › Shape: "the O squashing
 * circle → squircle → pill → circle", M3's loading-indicator idea in Roxy's
 * own shapes). Never a spinner. The O sits in `think` mood and squashes on a
 * loop (one squash per `LOADING_CYCLE_MS`, the loading indicator's cycle);
 * Reduce Motion holds her still. The words say what is happening, and a
 * screen reader hears them once (polite region).
 *
 * Wave 3 (jank audit #7): the loop is a reanimated shared value, so it runs
 * on the UI thread with no React render per frame (the legacy Animated loop
 * ran on the JS thread on web).
 */
export function RoxyWriting({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion || !canLoop) {
      t.value = 0;
      return undefined;
    }
    t.value = 0;
    t.value = withRepeat(
      withTiming(1, { duration: LOADING_CYCLE_MS, easing: Easing.inOut(Easing.ease), reduceMotion: ReduceMotion.Never }),
      -1,
      false,
    );
    return () => cancelAnimation(t);
  }, [reducedMotion, t]);

  const squash = useAnimatedStyle(() => ({
    transform: [
      { scaleX: interpolate(t.value, STOPS, SCALE_X) },
      { scaleY: interpolate(t.value, STOPS, SCALE_Y) },
    ],
  }));

  return (
    <View testID={testID} style={s.row} accessibilityLiveRegion="polite" accessibilityLabel="Roxy AI is writing">
      <SquashView testID={testID ? `${testID}-squash` : undefined} style={squash}>
        <RoxyO size={WRITING_O} mood="think" testID={testID ? `${testID}-o` : undefined} />
      </SquashView>
      <Text style={[s.label, { color: colors.ink2 }]}>Roxy AI is writing</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE[1] },
  label: { ...TYPE.meta },
});
