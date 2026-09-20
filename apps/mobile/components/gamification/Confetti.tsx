import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface Props {
  /** Starts the fall when this turns true. */
  active: boolean;
  count?: number;
  testID?: string;
}

/** The brand gradient's own colours, plus the two accents Roxy already uses. */
const COLOURS = ['#FF5A2E', '#F22481', '#E0189A', '#8B5CF6', '#FFD166', '#FFF8FB'];

const FALL_MS = 2600;

/**
 * Confetti, hand-rolled on RN's Animated.
 *
 * No new dependency: every confetti package on npm is a native module or a
 * Skia canvas, and this is a few dozen translating squares. `useNativeDriver`
 * keeps the whole thing off the JS thread, which is what stops it stuttering on
 * the exact frame the celebration is meant to feel good.
 *
 * Honours reduced motion by rendering NOTHING. A confetti burst is pure
 * decoration, so the correct amount of it for someone who has asked for less
 * movement is none — not a slower one.
 */
export function Confetti({ active, count = 34, testID = 'confetti' }: Props) {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  // Positions are decided once, not per render: re-randomising on every parent
  // update would make the pieces jump mid-fall.
  const pieces = useMemo(
    () => Array.from({ length: count }, (_, i) => ({
      key: i,
      x: Math.random() * width,
      size: 6 + Math.random() * 7,
      colour: COLOURS[i % COLOURS.length],
      delay: Math.random() * 420,
      drift: (Math.random() - 0.5) * 90,
      spin: Math.random() > 0.5 ? 1 : -1,
    })),
    [count, width],
  );

  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || reduced) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: FALL_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [active, reduced, progress]);

  if (!active || reduced) return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      // Decoration. It must never intercept the tap that dismisses the sheet
      // underneath it, and a screen reader has nothing to say about it.
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {pieces.map((piece) => {
        const start = piece.delay / FALL_MS;
        // Each piece maps the shared clock through its own delay, so one
        // animation drives all of them.
        const fall = progress.interpolate({
          inputRange: [0, Math.min(0.99, start), 1],
          outputRange: [-40, -40, height + 60],
          extrapolate: 'clamp',
        });
        const sway = progress.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, piece.drift, 0],
        });
        const spin = progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${piece.spin * 540}deg`],
        });
        const fade = progress.interpolate({
          inputRange: [0, 0.82, 1],
          outputRange: [1, 1, 0],
        });

        return (
          <Animated.View
            key={piece.key}
            style={{
              position: 'absolute',
              left: piece.x,
              width: piece.size,
              height: piece.size * 1.6,
              borderRadius: 1.5,
              backgroundColor: piece.colour,
              opacity: fade,
              transform: [
                { translateY: fall },
                { translateX: sway },
                { rotate: spin },
              ],
            }}
          />
        );
      })}
    </View>
  );
}
