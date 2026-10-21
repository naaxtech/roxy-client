import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { HEART } from '../../lib/postReactions';
import { IDENTITY } from '../../lib/theme';
import { animatedSpring } from '../../lib/motion';

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

type Shot = { x: number; y: number; small: boolean; key: number };

export const ReactionBurst = forwardRef<ReactionBurstHandle, { reducedMotion: boolean; testID?: string }>(
  function ReactionBurst({ reducedMotion, testID = 'reaction-burst' }, ref) {
    const [shot, setShot] = useState<Shot | null>(null);
    const keyRef = useRef(0);

    const play = useCallback((at: { x: number; y: number }, opts?: { small?: boolean }) => {
      if (reducedMotion) return;
      keyRef.current += 1;
      setShot({ x: at.x, y: at.y, small: opts?.small ?? false, key: keyRef.current });
    }, [reducedMotion]);

    useImperativeHandle(ref, () => ({ play }), [play]);

    return (
      <View testID={testID} style={StyleSheet.absoluteFill} pointerEvents="none">
        {shot ? (
          <Burst key={shot.key} shot={shot} onDone={() => setShot((s) => (s?.key === shot.key ? null : s))} />
        ) : null}
      </View>
    );
  },
);

function Burst({ shot, onDone }: { shot: Shot; onDone: () => void }) {
  const size = shot.small ? BURST.smallHeart : BURST.heart;
  const pop = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const fly = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.parallel([
      Animated.spring(pop, { toValue: 1, velocity: 8, ...animatedSpring('fastSpatial') }),
      Animated.spring(ring, { toValue: 1, ...animatedSpring('effects') }),
      Animated.timing(fly, {
        toValue: 1, duration: BURST.lifeMs, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(BURST.exitAfterMs),
        Animated.spring(exit, { toValue: 1, ...animatedSpring('effects') }),
      ]),
    ]);
    anim.start(({ finished }) => { if (finished) onDone(); });
    return () => anim.stop();
  }, [pop, ring, fly, exit, onDone]);

  const half = size / 2;
  return (
    <>
      <Animated.View
        testID="reaction-burst-ring"
        style={[
          s.ring,
          {
            left: shot.x - half, top: shot.y - half, width: size, height: size, borderRadius: half,
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] }) }],
          },
        ]}
      />
      {IDENTITY.map((colour, i) => {
        const angle = (i / IDENTITY.length) * Math.PI * 2 - Math.PI / 2;
        const reach = half + BURST.distance[i] * (shot.small ? 0.7 : 1);
        const d = BURST.dot[i];
        return (
          <Animated.View
            key={colour}
            testID={`reaction-burst-dot-${i}`}
            style={[
              s.dot,
              {
                backgroundColor: colour,
                width: d, height: d, borderRadius: d / 2,
                left: shot.x - d / 2, top: shot.y - d / 2,
                opacity: fly.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
                transform: [
                  { translateX: fly.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * reach] }) },
                  { translateY: fly.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * reach] }) },
                ],
              },
            ]}
          />
        );
      })}
      <Animated.View
        testID="reaction-burst-heart"
        style={[
          s.heart,
          {
            left: shot.x - half, top: shot.y - half, width: size, height: size,
            opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [
              { translateY: exit.interpolate({ inputRange: [0, 1], outputRange: [0, -half] }) },
              { scale: Animated.multiply(pop, exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] })) },
              { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${BURST.turnDeg}deg`] }) },
            ],
          },
        ]}
      >
        <Text
          testID="reaction-burst-emoji"
          style={{ fontSize: size * 0.8, lineHeight: size }}
          allowFontScaling={false}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {HEART}
        </Text>
      </Animated.View>
    </>
  );
}

const s = StyleSheet.create({
  heart: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: BURST.ring, borderColor: '#FFFFFF' },
  dot: { position: 'absolute' },
});
