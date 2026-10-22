import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useNavigationState, useRoute } from '@react-navigation/native';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPRING, springTo } from '../../lib/motion';
import { startWebSpring } from './webSpring';

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
 * Native: a reanimated spring on the UI thread. Web: a compositor animation
 * (WAAPI) with the same curve, started before the first paint — reanimated
 * runs on the web's main thread, where the destination's render stretched the
 * fade to 300-480 ms at 4x CPU.
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
  const isWeb = Platform.OS === 'web';
  const reducedMotion = useReducedMotion();
  const ownKey = useRoute().key;
  const selected = useNavigationState((s) => s.routes[s.index]?.key) === ownKey;
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  const webContent = useRef<View>(null);

  useEffect(() => {
    if (isWeb) return;
    if (reducedMotion) {
      opacity.value = 1;
    } else if (selected) {
      opacity.value = withSpring(1, springTo('effects'));
    } else {
      opacity.value = 0;
    }
  }, [isWeb, selected, reducedMotion, opacity]);

  // Before the browser paints the newly selected tab, so frame 1 is ground.
  useLayoutEffect(() => {
    if (!isWeb || reducedMotion || !selected) return;
    startWebSpring(webContent.current as unknown as Element, [{ opacity: 0 }, { opacity: 1 }], SPRING.effects);
  }, [isWeb, selected, reducedMotion]);

  const contentStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View testID={testID} style={[s.fill, { backgroundColor: ground }]}>
      {isWeb ? (
        <View
          ref={webContent}
          testID={`${testID}-content`}
          style={[s.fill, { opacity: selected || reducedMotion ? 1 : 0 }]}
        >
          {children}
        </View>
      ) : (
        <Animated.View testID={`${testID}-content`} style={[s.fill, contentStyle]}>
          {children}
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
});
