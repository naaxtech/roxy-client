import { Animated } from 'react-native';

/**
 * Roxy motion. Duolingo-like: snappy scale and translate, never a fade.
 *
 * Opacity dissolves are boring. A tap should answer with a pop that settles
 * in ~120–180ms and at most one tiny overshoot. Reduce Motion still wins —
 * `runSnap` jumps to the end value and skips the spring.
 */
export const SNAP_SPRING = {
  tension: 420,
  friction: 16,
  useNativeDriver: true,
} as const;

/** Squashier than SNAP — a press that answers immediately. */
export const PRESS_SPRING = {
  tension: 380,
  friction: 12,
  useNativeDriver: true,
} as const;

/** Entrance scale. Opaque the whole way; the pop is the reveal. */
export const POP_FROM = 0.76;

export function runSnap(
  value: Animated.Value,
  toValue: number,
  reducedMotion = false,
): void {
  if (reducedMotion) {
    value.setValue(toValue);
    return;
  }
  Animated.spring(value, { toValue, ...SNAP_SPRING }).start();
}

export function popInStyle(scale: Animated.Value): { transform: [{ scale: Animated.Value }] } {
  return { transform: [{ scale }] };
}
