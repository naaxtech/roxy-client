import { Animated } from 'react-native';

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
 * one frame: scale 0.96 plus an `ink` state layer at 8% (dark 10%); pills and
 * chips morph to radius 12; the one primary button drops 3 dp onto its lip.
 */
export const PRESS = {
  scale: 0.96,
  stateLayer: { light: 0.08, dark: 0.1 },
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
