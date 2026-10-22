import { useEffect, type ReactNode } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, {
  cancelAnimation,
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useThemeColors } from '../../hooks/useThemeColors';
import { RADII } from '../../lib/theme';
import { SKELETON, fadeConfig, springTo } from '../../lib/motion';

/**
 * Skeletons (polish/motion-spec.md §1.3 rule 6, §3.1 row 9; budgets F8, F9,
 * F12). Wave 3 lane C0.
 *
 * - `Skeleton`: one block at the content's FINAL geometry, in `raised` (the
 *   skeleton token). Compose blocks into the exact shape of the rows/cards
 *   they stand in for, so nothing moves when content lands (CLS ≤ 0.02).
 * - Every block shares ONE pulse clock (opacity 1 ↔ 0.55, 700 ms each way)
 *   that runs on the UI thread while any block is mounted. Reduce Motion:
 *   static. No stagger, ever.
 * - `SkeletonGroup` wraps a screen's blocks: one `progressbar` for screen
 *   readers ("Loading") and the screen's `<id>-loading` testID; the blocks
 *   themselves are hidden from assistive tech.
 * - `FadeIn` puts content on top when it arrives: opacity only, on
 *   `fastEffects` (≥ 2 frames, in by ~110 ms); Reduce Motion 120 ms; `instant`
 *   when the data was already in memory (a second visit never animates).
 *
 *   loading ? <SkeletonGroup testID="inbox-loading">…blocks…</SkeletonGroup>
 *           : <FadeIn instant={wasCached}>…rows…</FadeIn>
 */

// ─── the shared pulse clock ────────────────────────────────────────────────
let clock: SharedValue<number> | null = null;
let clockUsers = 0;

function pulseClock(): SharedValue<number> | null {
  // Partial jest mocks of reanimated lack makeMutable: blocks stay static.
  if (!clock && typeof makeMutable === 'function') clock = makeMutable(1);
  return clock;
}

function startPulse(c: SharedValue<number>): void {
  clockUsers += 1;
  if (clockUsers > 1) return;
  c.value = 1;
  c.value = withRepeat(
    withSequence(
      withTiming(SKELETON.low, { duration: SKELETON.halfMs }),
      withTiming(1, { duration: SKELETON.halfMs }),
    ),
    -1,
    false,
  );
}

function stopPulse(c: SharedValue<number>): void {
  clockUsers = Math.max(0, clockUsers - 1);
  if (clockUsers > 0) return;
  cancelAnimation(c);
  c.value = 1;
}

/** Subscribe a mounted block to the shared clock (none under Reduce Motion). */
function usePulse(reduced: boolean): SharedValue<number> | null {
  const c = pulseClock();
  useEffect(() => {
    if (reduced || !c || typeof withRepeat !== 'function') return undefined;
    startPulse(c);
    return () => stopPulse(c);
  }, [reduced, c]);
  return reduced ? null : c;
}

const animatable = typeof Reanimated?.createAnimatedComponent === 'function';
const AnimatedView = (animatable ? Reanimated.View : View) as unknown as typeof View;

export type SkeletonProps = {
  width?: DimensionValue;
  height?: DimensionValue;
  /** Corner radius (default `RADII.sm`). */
  radius?: number;
  /** An avatar/crest placeholder of this diameter (sets width, height, radius). */
  circle?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Skeleton({ width, height, radius = RADII.sm, circle, style, testID }: SkeletonProps) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const pulse = usePulse(reduced);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse ? pulse.value : 1 }));
  const geometry: ViewStyle =
    circle != null
      ? { width: circle, height: circle, borderRadius: circle / 2 }
      : { width, height, borderRadius: radius };
  return (
    <AnimatedView
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[geometry, { backgroundColor: colors.raised }, style, pulseStyle] as StyleProp<ViewStyle>}
    />
  );
}

export type SkeletonGroupProps = {
  children: ReactNode;
  /** The screen's loading testID, e.g. `inbox-loading` (feel probes look for `-loading`). */
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function SkeletonGroup({ children, testID, accessibilityLabel = 'Loading', style }: SkeletonGroupProps) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
      style={style}
    >
      {children}
    </View>
  );
}

export type FadeInProps = {
  children: ReactNode;
  /** Data was already in memory: show it with no fade. */
  instant?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function FadeIn({ children, instant = false, style, testID }: FadeInProps) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(instant ? 1 : 0);
  useEffect(() => {
    if (instant) {
      opacity.value = 1;
      return;
    }
    opacity.value = reduced ? withTiming(1, fadeConfig()) : withSpring(1, springTo('fastEffects'));
    // Mount-only: content fades in once, when it replaces the skeleton.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  // Opacity only — the wrapper adds no layout of its own (pass `style` for that).
  return (
    <AnimatedView testID={testID} style={[style, fade] as StyleProp<ViewStyle>}>
      {children}
    </AnimatedView>
  );
}
