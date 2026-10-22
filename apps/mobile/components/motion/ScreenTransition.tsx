import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { I18nManager, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPRING } from '../../lib/motion';
import { currentWebStyle, startWebFade, startWebSpring } from './webSpring';

/*
 * Mirrors of the Wave 3 tokens lane C0 adds to `lib/motion.ts`
 * (`ENTER.pushDp`, `ENTER.modalRiseDp`, `REDUCED.fadeMs`, `REST.px`; motion
 * spec §3.2). Replaced by the imports once C0 is merged into this branch.
 */
const PUSH_DP = 32;
const MODAL_RISE_DP = 48;
const REDUCED_FADE_MS = 120;
const REST_PX = 0.5;

export type TransitionPhase = 'enter' | 'idle' | 'exit';
export type TransitionKind = 'push' | 'modal';

/**
 * One screen of a stack, moving in or out (motion spec §3.1 row 5, F3, F12).
 *
 * Native-stack on the web only toggles `display`, so roxy.expo.app jump-cut
 * every screen change while the installed app slid. This is the web's
 * equivalent of the platform default:
 *
 * - push: translateX 32 dp → 0 on `SPRING.calm` (text is being read: no
 *   overshoot) while opacity goes 0 → 1 on `SPRING.effects`;
 * - modal routes rise 48 dp from the bottom edge instead;
 * - exit (pop) is the enter reversed — x back out on `calm`, opacity to 0 on
 *   `fastEffects` — and starts from wherever the screen is, because a spring
 *   retargets from its current value and velocity. A back press mid-push turns
 *   the screen around; it never jumps.
 *
 * RTL mirrors x. Reduce Motion: nothing moves; opacity fades in 120 ms.
 * A leaving screen stops taking touches at once — input never waits for an
 * animation.
 *
 * On the web (where this view is used) the move runs on the compositor with
 * WAAPI and the same curves (`webSpring`): reanimated's web springs run on the
 * main thread, and the new screen's own render stretched a 200 ms push to
 * ~360 ms at 4x CPU (jank audit #7). The reanimated path serves native.
 */
export function ScreenTransition({
  phase, kind, animate, children, testID, nativeID, style,
}: {
  phase: TransitionPhase;
  kind: TransitionKind;
  /** False for a screen that is simply there (the first screen of a stack). */
  animate: boolean;
  children: ReactNode;
  testID?: string;
  /** Names the layer (on the web, its element id), e.g. `screen-<route key>`. */
  nativeID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();
  const isWeb = Platform.OS === 'web';
  const out = kind === 'modal'
    ? { x: 0, y: MODAL_RISE_DP }
    : { x: I18nManager.isRTL ? -PUSH_DP : PUSH_DP, y: 0 };
  const moves = animate && !reducedMotion;
  const x = useSharedValue(moves && !isWeb ? out.x : 0);
  const y = useSharedValue(moves && !isWeb ? out.y : 0);
  const opacity = useSharedValue(animate && !isWeb ? 0 : 1);

  useEffect(() => {
    if (isWeb || phase === 'idle') return;
    const entering = phase === 'enter';
    if (entering && !animate) return;
    if (reducedMotion) {
      opacity.value = withTiming(entering ? 1 : 0, { duration: REDUCED_FADE_MS });
      return;
    }
    const spatial = { ...SPRING.calm, restDisplacementThreshold: REST_PX };
    if (kind === 'modal') y.value = withSpring(entering ? 0 : out.y, spatial);
    else x.value = withSpring(entering ? 0 : out.x, spatial);
    opacity.value = withSpring(entering ? 1 : 0, entering ? SPRING.effects : SPRING.fastEffects);
    // The phase drives this; kind/offsets are fixed for a screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Web: the element rests at its phase's end state and the compositor plays
  // the move (WAAPI, the same SPRING curves) before the browser paints — an
  // exit from wherever the screen is, so a back press mid-push turns around.
  const webLayer = useRef<View>(null);
  useLayoutEffect(() => {
    if (!isWeb || phase === 'idle') return;
    const entering = phase === 'enter';
    if (entering && !animate) return;
    const node = webLayer.current as unknown as Element;
    const now = entering ? null : currentWebStyle(node);
    const fromOpacity = now ? Number(now.opacity) : entering ? 0 : 1;
    if (reducedMotion) {
      startWebFade(node, fromOpacity, entering ? 1 : 0, REDUCED_FADE_MS);
      return;
    }
    const home = cssTranslate(0, 0);
    const away = cssTranslate(out.x, out.y);
    const fromTransform = entering ? away : now && now.transform !== 'none' ? now.transform : home;
    startWebSpring(node, [{ transform: fromTransform }, { transform: entering ? home : away }], SPRING.calm);
    startWebSpring(
      node,
      [{ opacity: fromOpacity }, { opacity: entering ? 1 : 0 }],
      entering ? SPRING.effects : SPRING.fastEffects,
    );
    // The phase drives this; kind/offsets are fixed for a screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const motion = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  if (isWeb) {
    const leaving = phase === 'exit';
    const rest = leaving && !reducedMotion ? out : { x: 0, y: 0 };
    return (
      <View
        ref={webLayer}
        testID={testID}
        nativeID={nativeID}
        pointerEvents={leaving ? 'none' : 'auto'}
        style={[
          StyleSheet.absoluteFill,
          style,
          { opacity: leaving ? 0 : 1, transform: [{ translateX: rest.x }, { translateY: rest.y }] },
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <Animated.View
      testID={testID}
      nativeID={nativeID}
      pointerEvents={phase === 'exit' ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, style, motion]}
    >
      {children}
    </Animated.View>
  );
}

const cssTranslate = (x: number, y: number) => `translateX(${x}px) translateY(${y}px)`;
