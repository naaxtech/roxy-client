import { Animated } from 'react-native';
import type { ReduceMotion } from 'react-native-reanimated';

/**
 * Roxy motion (design direction v2 › Motion): physics, not curves.
 *
 * M3 Expressive's spring tokens, ported as physical springs:
 * `{ mass: 1, stiffness, damping }` with damping = 2·ζ·√stiffness. Spatial
 * springs (position, size, rotation, radius) may overshoot; effects springs
 * (colour, opacity) never do (ζ = 1). The same numbers drive reanimated's
 * `withSpring(v, SPRING.x)` and the legacy `Animated.spring` (`animatedSpring`).
 *
 * NEVER pass `dampingRatio` to reanimated 3.10.1 without `duration`: that key
 * belongs to the duration-based spring, whose duration defaults to 2000 ms, so
 * every press would crawl (checked in reanimated's springUtils.ts).
 *
 * Reduce Motion (`hooks/useReducedMotion.ts`): spatial springs jump to their
 * end state (`runSpring(..., reduced)`), effects become short fades.
 *
 * src: polish/design-direction.md · v2 › Motion · 2026-10-21
 */
export const SPRING = {
  /** 800 / ζ 0.6 — press-in and release, chips, switch thumb, nav pill, FAB tuck. */
  fastSpatial: { mass: 1, stiffness: 800, damping: 33.9 },
  /** 380 / ζ 0.8 — sheets, the FAB → sheet morph, picker open/close, snackbar in. */
  spatial: { mass: 1, stiffness: 380, damping: 31.2 },
  /** 200 / ζ 0.8 — full-screen moments ("You're in", the seal's travel). */
  slowSpatial: { mass: 1, stiffness: 200, damping: 22.6 },
  /** 3800 / ζ 1 — colour and state-layer changes on press and selection. */
  fastEffects: { mass: 1, stiffness: 3800, damping: 123.3 },
  /** 1600 / ζ 1 — scrims, fades, the burst ring. */
  effects: { mass: 1, stiffness: 1600, damping: 80.0 },
  /** 800 / ζ 1 — full-screen crossfades. */
  slowEffects: { mass: 1, stiffness: 800, damping: 56.6 },
  /** 700 / ζ 0.9 (M3 standard) — page pushes, toasts, anything carrying text being read. */
  calm: { mass: 1, stiffness: 700, damping: 47.6 },
} as const;

export type SpringName = keyof typeof SPRING;

/**
 * Press feedback (Duolingo + M3). Every control answers on press-in, inside
 * one frame: scale 0.96 plus an `ink` state layer at 10% (M3's pressed
 * state-layer opacity; light was 8% until decisions.md 2026-10-23 P5); pills and
 * chips morph to radius 12; the one primary button drops 3 dp onto its lip.
 */
export const PRESS = {
  scale: 0.96,
  stateLayer: { light: 0.1, dark: 0.1 },
  radius: 12,
  lipDrop: 3,
} as const;

/** A `SPRING` token as a legacy `Animated.spring` config. */
export function animatedSpring(
  name: SpringName,
  useNativeDriver = true,
): { mass: number; stiffness: number; damping: number; useNativeDriver: boolean } {
  return { ...SPRING[name], useNativeDriver };
}

/**
 * Spring `value` to `toValue` with a named token, or jump there when Reduce
 * Motion is on. Returns the animation (or null when it jumped).
 */
export function runSpring(
  value: Animated.Value,
  toValue: number,
  name: SpringName,
  reducedMotion = false,
  useNativeDriver = true,
): Animated.CompositeAnimation | null {
  if (reducedMotion) {
    value.setValue(toValue);
    return null;
  }
  const animation = Animated.spring(value, { toValue, ...animatedSpring(name, useNativeDriver) });
  animation.start();
  return animation;
}

/**
 * SUPERSEDED by `SPRING.spatial` (v2, 2026-10-21). v0's snap spring
 * (Animated tension/friction). Kept exported, unchanged, because files owned
 * by Wave 2 lanes (`app/roxy-chat.tsx`, `components/ui/RoxyCompanionButton.tsx`)
 * still read it. Origin: `git log -S SNAP_SPRING` (Roxy 3.0 motion slice).
 * Remove once no caller imports it.
 */
export const SNAP_SPRING = {
  tension: 420,
  friction: 16,
  useNativeDriver: true,
} as const;

/**
 * SUPERSEDED by `SPRING.fastSpatial` (v2, 2026-10-21). Same story as
 * `SNAP_SPRING`; `RoxyCompanionButton.tsx` (Wave 2) still reads it.
 */
export const PRESS_SPRING = {
  tension: 380,
  friction: 12,
  useNativeDriver: true,
} as const;

/** Entrance scale. Opaque the whole way; the pop is the reveal. */
export const POP_FROM = 0.76;

/** Snap `value` to `toValue` on the `spatial` spring (sheets, pops). */
export function runSnap(
  value: Animated.Value,
  toValue: number,
  reducedMotion = false,
): void {
  runSpring(value, toValue, 'spatial', reducedMotion);
}

export function popInStyle(scale: Animated.Value): { transform: [{ scale: Animated.Value }] } {
  return { transform: [{ scale }] };
}

// ─── Wave 3 "Feel" token additions (polish/motion-spec.md §3.2) ───────────
//
// Rules that come with them:
// - Animate a 0 → 1 progress and interpolate to pixels, or spring pixels with
//   `springTo(name, { px: true })` (rest threshold `REST.px`). With the default
//   0.001 a 500 px sheet reports "finished" ~870 ms in, although it looks done
//   at ~250 ms. NEVER gate input or an unmount on a completion callback.
// - Reduce Motion is owned by `hooks/useReducedMotion` (live), so reanimated
//   springs go out with `reduceMotion: 'never'` (`springTo`) and the caller
//   jumps (spatial) or fades `REDUCED.fadeMs` (effects) itself.

/** Reduce Motion: effects become 120 ms fades (direction › Motion). */
export const REDUCED = { fadeMs: 120 } as const;

/** Waits (M3 loading indicator): nothing < 200 ms, then >= 400 ms, determinate after 5 s. */
export const WAIT = { showAfterMs: 200, minShowMs: 400, determinateAfterMs: 5000 } as const;

/** Skeleton pulse: one shared clock, opacity 1 ↔ 0.55, 700 ms each way. */
export const SKELETON = { low: 0.55, halfMs: 700 } as const;

/** Entrance distances (dp): web push, modal route rise, chat message rise. */
export const ENTER = { pushDp: 32, modalRiseDp: 48, messageRiseDp: 8 } as const;

/** Gesture physics (WWDC18 "Designing Fluid Interfaces"). */
export const GESTURE = {
  /** Projection: x + v/1000 · r/(1 − r). */
  decelerationRate: 0.998,
  /** Rubber band: (1 − 1/(x·c/d + 1))·d. */
  rubberBand: 0.55,
  /** A sheet dismisses past 35% of its height, projected… */
  dismissFraction: 0.35,
  /** …or when flung faster than this (dp/s). */
  flingDpPerS: 800,
  longPressMs: 300,
  /** Pull-to-refresh commits past this pull (dp). */
  refreshThresholdDp: 72,
} as const;

/** Spring rest thresholds: `unit` for 0 → 1 progress, `px` for pixel values. */
export const REST = { unit: 0.001, px: 0.5 } as const;

/** expo-image `transition` for content images (ms). */
export const CROSS_DISSOLVE_MS = 150;

/**
 * Where a released gesture would come to rest (WWDC18): the position plus the
 * distance its velocity (units/s) carries it at `GESTURE.decelerationRate`.
 * Choose the end state from this, not from where the finger lifted.
 */
export function projectRelease(position: number, velocity: number): number {
  'worklet';
  const r = GESTURE.decelerationRate;
  return position + ((velocity / 1000) * r) / (1 - r);
}

/**
 * iOS-style rubber band for a drag past an edge: follows the finger at first,
 * resists more the further it goes, never travels past `dimension`.
 */
export function rubberBand(overshoot: number, dimension: number): number {
  'worklet';
  if (overshoot === 0 || dimension <= 0) return 0;
  const x = Math.abs(overshoot);
  const banded = (1 - 1 / ((x * GESTURE.rubberBand) / dimension + 1)) * dimension;
  return overshoot < 0 ? -banded : banded;
}

/** A reanimated `withSpring` config for a `SPRING` token. */
export type SpringToConfig = {
  mass: number;
  stiffness: number;
  damping: number;
  velocity?: number;
  restDisplacementThreshold?: number;
  restSpeedThreshold?: number;
  /** reanimated's `ReduceMotion.Never`: this app decides Reduce Motion itself. */
  reduceMotion: ReduceMotion;
};

/**
 * reanimated's `ReduceMotion.Never` as its string value, so this module never
 * reads reanimated at runtime (several suites mock reanimated partially).
 */
const NEVER = 'never' as ReduceMotion;

/**
 * `withSpring(target, springTo('spatial', { px: true, velocity }))`.
 * `px`: the value is in pixels, so rest at `REST.px` instead of 0.001.
 * `velocity`: a released gesture's velocity, so the spring carries it on.
 */
export function springTo(
  name: SpringName,
  opts: { px?: boolean; velocity?: number } = {},
): SpringToConfig {
  'worklet';
  const config: SpringToConfig = { ...SPRING[name], reduceMotion: NEVER };
  if (opts.velocity !== undefined) config.velocity = opts.velocity;
  if (opts.px) {
    config.restDisplacementThreshold = REST.px;
    config.restSpeedThreshold = REST.px;
  }
  return config;
}

/**
 * A reanimated `withTiming` config for an effect under Reduce Motion:
 * `REDUCED.fadeMs` (120 ms), linear, and never skipped by reanimated.
 */
export function fadeConfig(durationMs: number = REDUCED.fadeMs): { duration: number; reduceMotion: ReduceMotion } {
  'worklet';
  return { duration: durationMs, reduceMotion: NEVER };
}
