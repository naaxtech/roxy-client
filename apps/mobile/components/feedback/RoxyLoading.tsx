import { useEffect, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useThemeColors } from '../../hooks/useThemeColors';
import { popElevation } from '../../lib/theme';
import { WAIT } from '../../lib/motion';

/**
 * Roxy's loading indicator (polish/motion-spec.md §1.3 rule 7, §3.1 rows 7
 * and 12; budget F11; decision P1 2026-10-23). Wave 3 lane C0.
 *
 * M3 Expressive's loading indicator made Roxy's: a FACELESS pink O (the
 * wordmark's ring, no eyes — her face belongs only inside Roxy AI's own chat)
 * that morphs through Roxy's shapes, circle → pill → rounded square → circle,
 * turning as it goes. Never a spinner.
 *
 * Waits by length (`WAIT`): nothing under 200 ms; once shown it stays at
 * least 400 ms so a wait that ends just after 200 ms never flickers. Keep it
 * MOUNTED and drive `active` (`<RoxyLoading active={saving} />`): unmounting
 * it skips the 400 ms minimum. Over 5 s the caller switches to a determinate
 * bar (uploads); this never turns into one.
 *
 * Sizes (`LOADING_SIZES`): `default` 48 dp box / 38 dp shape (M3), `busy`
 * 24 / 20 for PrimaryButton's busy state. `contained` sits the O on a
 * `surface` circle with the `pop` shadow (over content, pull-to-refresh).
 * `tone="stage"` uses `brandPink` on the always-dark feed stage.
 *
 * Reduce Motion: a still circle (no morph, no turn). Screen readers hear one
 * `progressbar` labelled "Loading".
 */
export const LOADING_SIZES = {
  default: { box: 48, shape: 38 },
  busy: { box: 24, shape: 20 },
} as const;

export type RoxyLoadingSize = keyof typeof LOADING_SIZES;

/** One morph cycle, ms (the writing O's squash cycle). */
export const LOADING_CYCLE_MS = 1200;

/** Ring thickness as a share of the shape (the wordmark O's weight). */
const RING = 0.14;

/**
 * Wait-length visibility (F11): false until `active` has held `showAfterMs`,
 * then true for at least `minShowMs` after it appeared.
 */
export function useWaitVisible(
  active: boolean,
  { showAfterMs = WAIT.showAfterMs, minShowMs = WAIT.minShowMs, delay = true }: {
    showAfterMs?: number;
    minShowMs?: number;
    /** `false`: show at once (the wait is already known to be long). */
    delay?: boolean;
  } = {},
): boolean {
  const [visible, setVisible] = useState(active && !delay);
  const shownAt = useRef<number | null>(active && !delay ? Date.now() : null);

  useEffect(() => {
    if (active) {
      if (visible) return undefined;
      const t = setTimeout(
        () => {
          shownAt.current = Date.now();
          setVisible(true);
        },
        delay ? showAfterMs : 0,
      );
      return () => clearTimeout(t);
    }
    if (!visible) return undefined;
    const left = Math.max(0, (shownAt.current ?? 0) + minShowMs - Date.now());
    const t = setTimeout(() => {
      shownAt.current = null;
      setVisible(false);
    }, left);
    return () => clearTimeout(t);
  }, [active, visible, showAfterMs, minShowMs, delay]);

  return visible;
}

/** Smoothstep 0 → 1 (ease in-out, no Easing import: partial mocks lack it). */
function ease(x: number): number {
  'worklet';
  return x * x * (3 - 2 * x);
}

/** circle → pill → rounded square → circle over one 0 → 1 phase. */
function shapeAt(phase: number): { r: number; sx: number; sy: number } {
  'worklet';
  // [corner radius as a share of the shape, scaleX, scaleY]
  const circle = [0.5, 1, 1];
  const pill = [0.5, 1.2, 0.8];
  const square = [0.3, 0.94, 0.94];
  const seq = [circle, pill, square, circle];
  const p = Math.min(Math.max(phase, 0), 0.999999) * 3;
  const i = Math.floor(p);
  const k = ease(p - i);
  const a = seq[i];
  const b = seq[i + 1];
  return { r: a[0] + (b[0] - a[0]) * k, sx: a[1] + (b[1] - a[1]) * k, sy: a[2] + (b[2] - a[2]) * k };
}

const animatable = typeof Reanimated?.createAnimatedComponent === 'function';
const AnimatedView = (animatable ? Reanimated.View : View) as unknown as typeof View;

export type RoxyLoadingProps = {
  /** The wait is on. Keep the component mounted and flip this. Default true. */
  active?: boolean;
  size?: RoxyLoadingSize;
  contained?: boolean;
  tone?: 'pink' | 'stage';
  /** `false`: skip the 200 ms grace (e.g. a refresh she already committed to). */
  delay?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function RoxyLoading({
  active = true,
  size = 'default',
  contained = false,
  tone = 'pink',
  delay = true,
  accessibilityLabel = 'Loading',
  style,
  testID = 'roxy-loading',
}: RoxyLoadingProps) {
  const visible = useWaitVisible(active, { delay });
  if (!visible) return null;
  return (
    <LoadingO
      size={size}
      contained={contained}
      tone={tone}
      accessibilityLabel={accessibilityLabel}
      style={style}
      testID={testID}
    />
  );
}

/** The O itself, always visible (RoxyRefresh drives its own visibility). */
export function LoadingO({
  size = 'default',
  contained = false,
  tone = 'pink',
  accessibilityLabel = 'Loading',
  style,
  testID = 'roxy-loading',
}: Omit<RoxyLoadingProps, 'active' | 'delay'>) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const { box, shape } = LOADING_SIZES[size];
  const phase = useSharedValue(0);

  useEffect(() => {
    if (reduced || typeof withRepeat !== 'function') {
      phase.value = 0;
      return undefined;
    }
    phase.value = 0;
    phase.value = withRepeat(withTiming(1, { duration: LOADING_CYCLE_MS }), -1, false);
    return () => cancelAnimation(phase);
  }, [reduced, phase]);

  const morph = useAnimatedStyle(() => {
    const s = shapeAt(phase.value);
    return {
      borderRadius: s.r * shape,
      transform: [{ rotate: `${phase.value * 360}deg` }, { scaleX: s.sx }, { scaleY: s.sy }],
    };
  });

  const ring = tone === 'stage' ? colors.brandPink : colors.pink;
  const box_: ViewStyle = {
    width: box,
    height: box,
    alignItems: 'center',
    justifyContent: 'center',
    ...(contained ? { backgroundColor: colors.surface, borderRadius: box / 2, ...popElevation(colors) } : null),
  };

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
      style={[box_, style]}
    >
      <AnimatedView
        testID={`${testID}-o`}
        style={[
          {
            width: shape,
            height: shape,
            borderWidth: Math.max(2, Math.round(shape * RING)),
            borderColor: ring,
            borderRadius: shape / 2,
          },
          morph,
        ] as StyleProp<ViewStyle>}
      />
    </View>
  );
}
