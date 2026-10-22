import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useNavigationState, useRoute } from '@react-navigation/native';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPRING } from '../../lib/motion';

/**
 * A tab's content fading in over its own ground (motion spec §3.1 row 4, F4).
 *
 * M3's top-level pattern: the new destination's ground is on screen in the
 * first frame and only its content fades in (`SPRING.effects`, ~170 ms, no
 * overshoot). No slide (lateral motion is wrong for top-level destinations),
 * no scale, nothing that moves layout. Tab switches used to be a jump cut on
 * every platform.
 *
 * Mount it as the outermost view of a tab's layout. It follows whether THIS
 * tab is the Tabs navigator's selected route — not screen focus: a root screen
 * pushed over the tabs blurs the tab without a tab switch, and the pop must
 * reveal the tab as it was. While another tab is selected the content waits at
 * opacity 0 (it is hidden anyway), so the next visit starts on ground.
 *
 * Reduce Motion: the content is simply there (row 4: "no fade (instant)").
 */
export function TabFade({
  ground, children, testID = 'tab-fade',
}: {
  /** The tab's ground colour, painted under the fading content. */
  ground: string;
  children: ReactNode;
  testID?: string;
}) {
  const reducedMotion = useReducedMotion();
  const ownKey = useRoute().key;
  const selected = useNavigationState((s) => s.routes[s.index]?.key) === ownKey;
  const opacity = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 1;
    } else if (selected) {
      opacity.value = withSpring(1, SPRING.effects);
    } else {
      opacity.value = 0;
    }
  }, [selected, reducedMotion, opacity]);

  const contentStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View testID={testID} style={[s.fill, { backgroundColor: ground }]}>
      <Animated.View testID={`${testID}-content`} style={[s.fill, contentStyle]}>
        {children}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
});
