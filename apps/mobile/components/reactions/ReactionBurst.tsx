import { forwardRef, useCallback, useImperativeHandle } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { HEART } from '../../lib/postReactions';
import { IDENTITY } from '../../lib/theme';
import { SPRING } from '../../lib/motion';

/**
 * The double-tap burst (direction v2 › Reactions, board v2-04, 180 ms in).
 *
 * The heart pops where the thumb was: 80 dp, scale 0 → past 1 → 1 with a -8°
 * turn (`fastSpatial`, which overshoots on its own, started with velocity), a
 * white 3 dp ring expanding and fading (`effects`), six 8-10 dp dots in the
 * identity colours flying 24-40 dp and gone within 480 ms; then the heart
 * lifts toward the rail and fades while the rail's button squishes. The
 * everyday interaction, not a signature moment: no confetti, nothing that
 * lingers. Replaces the retired `components/feed/LikeBurst.tsx` (the ✿).
 *
 * `pointerEvents="none"` throughout: it never takes a touch. Reduce Motion:
 * `play` draws nothing (the reaction itself still lands on the rail).
 *
 * Runs on reanimated (Wave 3, motion spec §3.1 row 11): the layer is mounted
 * once, at rest in its finished state (invisible), and `play` only writes
 * shared values. A double tap therefore starts the burst without a React
 * render, and every frame runs on the UI thread, so a busy JS thread cannot
 * eat it. A replay mid-burst restarts from the new point.
 */
export interface ReactionBurstHandle {
  play: (at: { x: number; y: number }, opts?: { small?: boolean }) => void;
}

export const BURST = {
  heart: 80,
  /** "Double-tapping again replays a smaller burst." */
  smallHeart: 56,
  ring: 3,
  /** Dots: size 8-10 dp, distance 24-40 dp, life 480 ms. */
  dot: [8, 10, 9, 8, 10, 9],
  distance: [32, 40, 24, 36, 28, 40],
  lifeMs: 480,
  /** When the heart starts for the rail. */
  exitAfterMs: 300,
  turnDeg: -8,
} as const;

/** Start one value from `from` with an animation (the jump is part of the animation, so it lands in order). */
function restart(v: SharedValue<number>, from: number, then: number): void {
  v.value = withSequence(withTiming(from, { duration: 0 }), then);
}

export const ReactionBurst = forwardRef<ReactionBurstHandle, { reducedMotion: boolean; testID?: string }>(
  function ReactionBurst({ reducedMotion, testID = 'reaction-burst' }, ref) {
    const x = useSharedValue(0);
    const y = useSharedValue(0);
    /** 1 for the full burst, smaller for a replay. */
    const size = useSharedValue(1);
    // At rest every value sits at its finished state, so nothing shows.
    const pop = useSharedValue(0);
    const ring = useSharedValue(1);
    const fly = useSharedValue(1);
    const exit = useSharedValue(1);

    const play = useCallback((at: { x: number; y: number }, opts?: { small?: boolean }) => {
      if (reducedMotion) return;
      x.value = at.x;
      y.value = at.y;
      size.value = opts?.small ? BURST.smallHeart / BURST.heart : 1;
      restart(pop, 0, withSpring(1, { ...SPRING.fastSpatial, velocity: 8 }));
      restart(ring, 0, withSpring(1, SPRING.effects));
      restart(fly, 0, withTiming(1, { duration: BURST.lifeMs, easing: Easing.out(Easing.cubic) }));
      restart(exit, 0, withDelay(BURST.exitAfterMs, withSpring(1, SPRING.effects)));
    }, [reducedMotion, x, y, size, pop, ring, fly, exit]);

    useImperativeHandle(ref, () => ({ play }), [play]);

    const half = BURST.heart / 2;

    const ringStyle = useAnimatedStyle(() => ({
      opacity: 1 - ring.value,
      transform: [
        { translateX: x.value - half },
        { translateY: y.value - half },
        { scale: size.value * (0.6 + ring.value) },
      ],
    }));

    const heartStyle = useAnimatedStyle(() => ({
      opacity: 1 - exit.value,
      transform: [
        { translateX: x.value - half },
        { translateY: y.value - half - exit.value * half * size.value },
        { scale: size.value * pop.value * (1 - 0.4 * exit.value) },
        { rotate: `${pop.value * BURST.turnDeg}deg` },
      ],
    }));

    return (
      <View testID={testID} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Animated.View
          testID="reaction-burst-ring"
          style={[s.ring, { width: BURST.heart, height: BURST.heart, borderRadius: half }, ringStyle]}
        />
        {IDENTITY.map((colour, i) => (
          <Dot key={colour} i={i} colour={colour} x={x} y={y} size={size} fly={fly} />
        ))}
        <Animated.View
          testID="reaction-burst-heart"
          style={[s.heart, { width: BURST.heart, height: BURST.heart }, heartStyle]}
        >
          <Text
            testID="reaction-burst-emoji"
            style={{ fontSize: BURST.heart * 0.8, lineHeight: BURST.heart }}
            allowFontScaling={false}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {HEART}
          </Text>
        </Animated.View>
      </View>
    );
  },
);

function Dot({
  i, colour, x, y, size, fly,
}: {
  i: number;
  colour: string;
  x: SharedValue<number>;
  y: SharedValue<number>;
  size: SharedValue<number>;
  fly: SharedValue<number>;
}) {
  const d = BURST.dot[i];
  const angle = (i / IDENTITY.length) * Math.PI * 2 - Math.PI / 2;
  const distance = BURST.distance[i];
  const style = useAnimatedStyle(() => {
    // A smaller replay throws its dots 70% as far.
    const reach = (BURST.heart / 2) * size.value + distance * (size.value < 1 ? 0.7 : 1);
    return {
      // Full until 70% of its life, then out by the end.
      opacity: fly.value <= 0.7 ? 1 : Math.max(0, (1 - fly.value) / 0.3),
      transform: [
        { translateX: x.value - d / 2 + Math.cos(angle) * reach * fly.value },
        { translateY: y.value - d / 2 + Math.sin(angle) * reach * fly.value },
      ],
    };
  });
  return (
    <Animated.View
      testID={`reaction-burst-dot-${i}`}
      style={[s.dot, { backgroundColor: colour, width: d, height: d, borderRadius: d / 2 }, style]}
    />
  );
}

const s = StyleSheet.create({
  heart: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', left: 0, top: 0, borderWidth: BURST.ring, borderColor: '#FFFFFF' },
  dot: { position: 'absolute', left: 0, top: 0 },
});
