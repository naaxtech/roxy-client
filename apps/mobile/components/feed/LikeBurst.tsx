import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { STAGE } from './stageColors';

/**
 * The like moment: a ✿ that blooms where she double-tapped, with six petals
 * thrown outward (FEED-07, FEED-09).
 *
 * ✿ is the prototype's signature react. The rail keeps its heart icon, which
 * every member already reads as "like"; the bloom is the celebration on top.
 *
 * Drawn with `pointerEvents="none"` so it never takes a touch. With reduce
 * motion on, `play()` does nothing: the like itself still lands.
 */
export interface LikeBurstHandle {
  play: () => void;
}

const PETALS = 6;
const PETAL_DISTANCE = 86;

export const LikeBurst = forwardRef<LikeBurstHandle, { reducedMotion: boolean; testID?: string }>(
  function LikeBurst({ reducedMotion, testID = 'like-burst' }, ref) {
    const bloom = useSharedValue(0);
    const spread = useSharedValue(0);
    const fade = useSharedValue(0);
    const plays = useRef(0);

    const play = useCallback(() => {
      if (reducedMotion) return;
      plays.current += 1;
      bloom.value = 0;
      spread.value = 0;
      fade.value = 1;
      bloom.value = withSequence(
        withSpring(1.25, { damping: 9, stiffness: 420 }),
        withDelay(140, withSpring(0, { damping: 14, stiffness: 380 })),
      );
      spread.value = withTiming(1, { duration: 520 });
      fade.value = withDelay(260, withTiming(0, { duration: 320 }));
    }, [reducedMotion, bloom, spread, fade]);

    useImperativeHandle(ref, () => ({ play }), [play]);

    const flowerStyle = useAnimatedStyle(() => ({
      transform: [{ scale: bloom.value }],
    }));

    return (
      <View testID={testID} style={s.layer} pointerEvents="none">
        {Array.from({ length: PETALS }, (_, i) => (
          <Petal key={i} index={i} spread={spread} fade={fade} />
        ))}
        <Animated.View style={flowerStyle}>
          <Text style={s.flower} accessibilityElementsHidden importantForAccessibility="no">
            ✿
          </Text>
        </Animated.View>
      </View>
    );
  },
);

function Petal({
  index, spread, fade,
}: {
  index: number;
  spread: { value: number };
  fade: { value: number };
}) {
  const angle = (index / PETALS) * Math.PI * 2;
  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [
      { translateX: Math.cos(angle) * PETAL_DISTANCE * spread.value },
      { translateY: Math.sin(angle) * PETAL_DISTANCE * spread.value },
      { scale: 0.6 + spread.value * 0.4 },
    ],
  }));
  return (
    <Animated.View style={[s.petalWrap, style]}>
      <Text style={[s.petal, { color: index % 2 ? STAGE.gold : STAGE.roxy }]}>✿</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flower: {
    fontSize: 120,
    color: STAGE.roxy,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  petalWrap: { position: 'absolute' },
  petal: { fontSize: 26 },
});
