import { forwardRef, useCallback, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type TouchableOpacityProps,
  type ViewStyle,
} from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { THEMES } from '../../lib/theme';
import { PRESS, fadeConfig, springAt, springTo } from '../../lib/motion';
import { useThemeStore } from '../../store/themeStore';

/**
 * Roxy's one pressable primitive (design direction v2 › Motion › Press states;
 * v3 for Wave 3 "Feel", polish/motion-spec.md §4.2 C0 and budget F1).
 *
 * Every control answers on press-IN, inside one frame, not on release:
 *  - scale to 0.96 on `SPRING.fastSpatial` (Reduce Motion: jumps there);
 *  - a state layer of `ink` at 10% on `SPRING.fastEffects` (Reduce Motion: a
 *    120 ms fade);
 *  - pills and chips (radius ≥ `PILL_RADIUS_MIN`, or `morph`) morph their
 *    corners to 12 while pressed — M3 Expressive's button-group morph.
 *
 * `feedback`: `'full'` (default) scales and lays the state layer; `'layer'`
 * keeps only the state layer (for big surfaces, where a 4% shrink would read
 * as the page moving); `'none'` is a plain Pressable.
 *
 * v3 (jank-audit #2, #9): the press path is reanimated shared values set
 * straight from the press handler — no React state, no re-render, so the
 * visual never waits for a render batched with whatever the tap triggers.
 * The state layer is always mounted at opacity 0 (`press-state-layer`;
 * read its opacity, not its presence). A pill's height lives in a shared
 * value, not state. On web RN-web's 50 ms press delay is off.
 *
 * Semantics stay RN `Pressable`'s (spike outcome, spec §4.2): TalkBack /
 * VoiceOver activation, web Enter/Space with the browser focus ring, and a
 * scroll taking the touch cancels the press (pressOut without press). An
 * RNGH `Gesture.Tap` host was rejected: RNGH 2.16 has no keyboard activation
 * on web and sets `touch-action: none` on its view, so a list could not be
 * scrolled from a pressable on mobile web.
 *
 * Only a caller whose `style` or `children` is a function of `pressed`
 * (RoxyChip) re-renders on press — after the shared values already moved.
 *
 * `TouchableOpacity` below is the drop-in the app imports in place of React
 * Native's: same props, so a screen gets v2 press feedback by changing one
 * import line. `activeOpacity={1}` (the old "no feedback" idiom, used on
 * backdrops and full-screen tap targets) maps to `feedback="none"`.
 */
export type PressFeedback = 'full' | 'layer' | 'none';

/** At or above this radius a control is a pill and morphs on press. */
export const PILL_RADIUS_MIN = 100;

type PressState = PressableStateCallbackType;

export type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle> | ((state: PressState) => StyleProp<ViewStyle>);
  children?: ReactNode | ((state: PressState) => ReactNode);
  feedback?: PressFeedback;
  /** Force (or forbid) the press-in corner morph. Default: pills morph. */
  morph?: boolean;
  /** Press-in delay, ms. Default 0 on every platform (RN-web's own default is 50). */
  delayPressIn?: number;
};

// Several suites mock reanimated with only `{ View }` and the hooks; there the
// hosts fall back to plain RN views and the styles stay static.
// (`createAnimatedComponent` lives only on reanimated's default export.)
const animatable = typeof Reanimated?.createAnimatedComponent === 'function';
const AnimatedPressable = (
  animatable ? Reanimated.createAnimatedComponent(Pressable) : Pressable
) as unknown as typeof Pressable;
const LayerView = (animatable ? Reanimated.View : View) as unknown as typeof View;

const NO_TRANSFORM: NonNullable<ViewStyle['transform']> = [];

/**
 * One-frame head start for a press from rest (F1): an animation's first step
 * paints a frame after it starts (reanimated on web; the JS → UI hop on
 * native), a direct assignment paints on the next frame. So press-in sets
 * each spring's own position and velocity one 60 Hz frame in, then springs on
 * from there: the identical trajectory, one frame sooner on screen.
 */
export const PRESS_HEAD_START = {
  spatial: springAt('fastSpatial', 1000 / 60),
  effects: springAt('fastEffects', 1000 / 60),
} as const;

/** The state-layer ink and alpha for a theme: `ink` at 10% (M3 pressed). */
export function stateLayerFor(theme: 'light' | 'dark'): { color: string; alpha: number } {
  return { color: THEMES[theme].ink, alpha: PRESS.stateLayer[theme] };
}

/**
 * The corner while pressed. A pill's visible radius is half its height, so
 * the morph starts THERE (a 999 → 12 spring would change nothing on screen
 * for 95% of its travel). At rest the caller's own radius stands.
 */
function cornerRadius(progress: number, restRadius: number, height: number): number {
  'worklet';
  if (progress <= 0) return restRadius;
  const visible = height > 0 ? Math.min(restRadius, height / 2) : Math.min(restRadius, 28);
  return visible + (PRESS.radius - visible) * progress;
}

export const PressableScale = forwardRef<View, PressableScaleProps>(function PressableScale(
  {
    style,
    children,
    feedback = 'full',
    morph,
    disabled,
    delayPressIn,
    onPressIn,
    onPressOut,
    onLayout,
    ...rest
  },
  ref,
) {
  const reducedMotion = useReducedMotion();
  /** Spatial press progress 0 → 1: scale and corner. */
  const progress = useSharedValue(0);
  /** Effects press progress 0 → 1: the state layer. */
  const layer = useSharedValue(0);
  /** A pill's measured height (shared value: measuring never re-renders). */
  const height = useSharedValue(0);
  // A quick click (web) fires pressIn and pressOut back to back; the ref is
  // always current, so the release always lands.
  const pressedRef = useRef(false);
  // Only a caller whose style or children read `pressed` pays a re-render.
  const readsPressed = typeof style === 'function' || typeof children === 'function';
  const [pressedForCaller, setPressedForCaller] = useState(false);

  const state = { pressed: pressedForCaller, hovered: false } as PressState;
  const userStyle = typeof style === 'function' ? style(state) : style;
  const flat = (StyleSheet.flatten(userStyle) ?? {}) as ViewStyle;
  const restRadius = typeof flat.borderRadius === 'number' ? flat.borderRadius : 0;
  const morphs = feedback !== 'none' && (morph ?? restRadius >= PILL_RADIUS_MIN);
  const scales = feedback === 'full';
  const active = feedback !== 'none' && !disabled;
  const userTransform = (flat.transform ?? NO_TRANSFORM) as NonNullable<ViewStyle['transform']>;
  const { color: layerColor, alpha } = stateLayerFor(useThemeStore.getState().theme);

  const pressTo = useCallback(
    (to: 0 | 1) => {
      if (reducedMotion) {
        progress.value = to;
        layer.value = withTiming(to, fadeConfig());
      } else if (to === 1 && progress.value <= 0.001 && layer.value <= 0.001) {
        const { spatial, effects } = PRESS_HEAD_START;
        progress.value = spatial.x;
        layer.value = effects.x;
        progress.value = withSpring(1, springTo('fastSpatial', { velocity: spatial.v }));
        layer.value = withSpring(1, springTo('fastEffects', { velocity: effects.v }));
      } else {
        // Mid-flight (a re-press during the release): retarget from where it is.
        progress.value = withSpring(to, springTo('fastSpatial'));
        layer.value = withSpring(to, springTo('fastEffects'));
      }
    },
    [reducedMotion, progress, layer],
  );

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      if (active) {
        pressedRef.current = true;
        pressTo(1);
        if (readsPressed) setPressedForCaller(true);
      }
      onPressIn?.(e);
    },
    [active, pressTo, readsPressed, onPressIn],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      if (pressedRef.current) {
        pressedRef.current = false;
        pressTo(0);
        if (readsPressed) setPressedForCaller(false);
      }
      onPressOut?.(e);
    },
    [pressTo, readsPressed, onPressOut],
  );

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (morphs) height.value = e.nativeEvent.layout.height;
      onLayout?.(e);
    },
    [morphs, height, onLayout],
  );

  const hostMotion = useAnimatedStyle(() => {
    const out: ViewStyle = {};
    if (scales) {
      out.transform = [...userTransform, { scale: 1 + (PRESS.scale - 1) * progress.value }] as ViewStyle['transform'];
    }
    if (morphs) out.borderRadius = cornerRadius(progress.value, restRadius, height.value);
    return out;
  });

  const layerMotion = useAnimatedStyle(() => ({
    opacity: layer.value * alpha,
    borderRadius: morphs ? cornerRadius(progress.value, restRadius, height.value) : restRadius,
  }));

  // RN-web reads `delayPressIn` (default 50 ms); native Pressable reads
  // `unstable_pressDelay` (default 0).
  const delayProps =
    Platform.OS === 'web'
      ? { delayPressIn: delayPressIn ?? 0 }
      : delayPressIn !== undefined
        ? { unstable_pressDelay: delayPressIn }
        : null;

  const layerEl =
    feedback !== 'none' ? (
      <LayerView
        testID="press-state-layer"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: layerColor }, layerMotion] as StyleProp<ViewStyle>}
      />
    ) : null;

  return (
    <AnimatedPressable
      ref={ref}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onLayout={morphs || onLayout ? handleLayout : undefined}
      {...delayProps}
      {...rest}
      style={[userStyle, hostMotion] as StyleProp<ViewStyle>}
    >
      {typeof children === 'function' ? children(state) : children}
      {layerEl}
    </AnimatedPressable>
  );
});

/**
 * Drop-in for React Native's `TouchableOpacity`, with v2 press feedback.
 * Same props; `activeOpacity={1}` keeps its meaning (no feedback);
 * `delayPressIn` keeps its meaning on every platform.
 */
export type TouchableProps = TouchableOpacityProps & {
  feedback?: PressFeedback;
  morph?: boolean;
};

export const TouchableOpacity = forwardRef<View, TouchableProps>(function TouchableOpacity(
  { activeOpacity, delayPressIn, feedback, children, ...rest },
  ref,
) {
  const resolved: PressFeedback = feedback ?? (activeOpacity === 1 ? 'none' : 'full');
  return (
    <PressableScale
      ref={ref}
      feedback={resolved}
      delayPressIn={delayPressIn}
      {...(rest as Omit<PressableScaleProps, 'children' | 'feedback'>)}
    >
      {children}
    </PressableScale>
  );
});
