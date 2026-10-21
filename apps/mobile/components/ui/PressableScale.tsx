import { forwardRef, useCallback, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type TouchableOpacityProps,
  type View,
  type ViewStyle,
} from 'react-native';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { THEMES } from '../../lib/theme';
import { PRESS, animatedSpring } from '../../lib/motion';
import { useThemeStore } from '../../store/themeStore';

/**
 * Roxy's one pressable primitive (design direction v2 › Motion › Press states).
 *
 * Every control answers on press-IN, inside one frame, not on release:
 *  - scale to 0.96 on `SPRING.fastSpatial` (Reduce Motion: jumps there);
 *  - a state layer of `ink` at 8% (dark 10%) on `SPRING.fastEffects`;
 *  - pills and chips (radius ≥ `PILL_RADIUS_MIN`, or `morph`) morph their
 *    corners to 12 while pressed — M3 Expressive's button-group morph.
 *
 * `feedback`: `'full'` (default) scales and lays the state layer; `'layer'`
 * keeps only the state layer (for big surfaces, where a 4% shrink would read
 * as the page moving); `'none'` is a plain Pressable.
 *
 * The state layer is mounted only while pressed or fading, so a pressable at
 * rest renders exactly its own children.
 *
 * Driver: a corner radius cannot run on the native animation driver, and one
 * component cannot mix drivers (native-driving its transform would drag the
 * JS-driven radius node native with it). So a control that morphs runs its
 * whole press on the JS driver; everything else stays native.
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
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The state-layer ink and alpha for a theme: `ink` at 8% light, 10% dark. */
export function stateLayerFor(theme: 'light' | 'dark'): { color: string; alpha: number } {
  return { color: THEMES[theme].ink, alpha: PRESS.stateLayer[theme] };
}

export const PressableScale = forwardRef<View, PressableScaleProps>(function PressableScale(
  {
    style,
    children,
    feedback = 'full',
    morph,
    disabled,
    onPressIn,
    onPressOut,
    onLayout,
    ...rest
  },
  ref,
) {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const layer = useRef(new Animated.Value(0)).current;
  const corner = useRef(new Animated.Value(0)).current;
  const [pressed, setPressed] = useState(false);
  // The release must not read `pressed` from render state: a quick click (web)
  // fires pressIn and pressOut before React re-renders, and a stale `false`
  // left the state layer on for good. The ref is always current.
  const pressedRef = useRef(false);
  const [layerOn, setLayerOn] = useState(false);
  const [height, setHeight] = useState<number | null>(null);

  const state = { pressed, hovered: false } as PressState;
  const userStyle = typeof style === 'function' ? style(state) : style;
  const flat = (StyleSheet.flatten(userStyle) ?? {}) as ViewStyle;
  const restRadius = typeof flat.borderRadius === 'number' ? flat.borderRadius : 0;
  const morphs = feedback !== 'none' && (morph ?? restRadius >= PILL_RADIUS_MIN);
  const active = feedback !== 'none' && !disabled;
  const native = !morphs;

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      if (active) {
        pressedRef.current = true;
        setPressed(true);
        setLayerOn(true);
        if (reducedMotion) {
          if (feedback === 'full') scale.setValue(PRESS.scale);
          if (morphs) corner.setValue(1);
          layer.setValue(1);
        } else {
          if (feedback === 'full') {
            Animated.spring(scale, { toValue: PRESS.scale, ...animatedSpring('fastSpatial', native) }).start();
          }
          if (morphs) {
            Animated.spring(corner, { toValue: 1, ...animatedSpring('fastSpatial', native) }).start();
          }
          Animated.spring(layer, { toValue: 1, ...animatedSpring('fastEffects', native) }).start();
        }
      }
      onPressIn?.(e);
    },
    [active, feedback, morphs, native, reducedMotion, scale, corner, layer, onPressIn],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      if (pressedRef.current) {
        pressedRef.current = false;
        setPressed(false);
        if (reducedMotion) {
          scale.setValue(1);
          corner.setValue(0);
          layer.setValue(0);
          setLayerOn(false);
        } else {
          if (feedback === 'full') {
            Animated.spring(scale, { toValue: 1, ...animatedSpring('fastSpatial', native) }).start();
          }
          if (morphs) {
            Animated.spring(corner, { toValue: 0, ...animatedSpring('fastSpatial', native) }).start();
          }
          Animated.spring(layer, { toValue: 0, ...animatedSpring('fastEffects', native) }).start(
            ({ finished }) => {
              // Interrupted by a new press: that press owns the layer now.
              if (finished && !pressedRef.current) setLayerOn(false);
            },
          );
        }
      }
      onPressOut?.(e);
    },
    [feedback, morphs, native, reducedMotion, scale, corner, layer, onPressOut],
  );

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (morphs) setHeight(e.nativeEvent.layout.height);
      onLayout?.(e);
    },
    [morphs, onLayout],
  );

  // A pill's visible radius is half its height; animate from THAT to 12, or
  // the first 95% of a 999 → 12 spring would change nothing on screen.
  const visibleRest = height != null ? Math.min(restRadius, height / 2) : Math.min(restRadius, 28);
  const radius = morphs
    ? corner.interpolate({ inputRange: [0, 1], outputRange: [visibleRest, PRESS.radius] })
    : undefined;

  const userTransform = (flat.transform ?? []) as NonNullable<ViewStyle['transform']>;
  // Animated's style types cannot express "a caller's static transforms plus
  // one Animated scale" in a single array; the runtime handles it.
  const pressStyle =
    feedback === 'full'
      ? ({ transform: [...(userTransform as object[]), { scale }] } as unknown as ViewStyle)
      : undefined;
  const cornerStyle =
    radius !== undefined && (pressed || layerOn) ? { borderRadius: radius } : undefined;

  const { color: layerColor, alpha } = stateLayerFor(useThemeStore.getState().theme);

  return (
    <AnimatedPressable
      ref={ref}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onLayout={morphs || onLayout ? handleLayout : undefined}
      {...rest}
      style={[userStyle, pressStyle, cornerStyle]}
    >
      {typeof children === 'function' ? children(state) : children}
      {layerOn ? (
        <Animated.View
          testID="press-state-layer"
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: layerColor,
              borderRadius: radius ?? restRadius,
              opacity: layer.interpolate({ inputRange: [0, 1], outputRange: [0, alpha] }),
            },
          ]}
        />
      ) : null}
    </AnimatedPressable>
  );
});

/**
 * Drop-in for React Native's `TouchableOpacity`, with v2 press feedback.
 * Same props; `activeOpacity={1}` keeps its meaning (no feedback);
 * `delayPressIn` maps to Pressable's press delay.
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
      unstable_pressDelay={delayPressIn}
      {...(rest as Omit<PressableScaleProps, 'children' | 'feedback'>)}
    >
      {children}
    </PressableScale>
  );
});
