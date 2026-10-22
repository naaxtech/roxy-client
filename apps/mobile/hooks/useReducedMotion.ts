import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
// reanimated's `useReducedMotion` is not a React hook: it returns a constant
// read once when reanimated loads (the native `_REANIMATED_IS_REDUCED_MOTION`
// global, `prefers-reduced-motion` on web). Aliased so it reads as what it is.
import { useReducedMotion as reanimatedLaunchValue } from 'react-native-reanimated';

/**
 * Whether the OS "Reduce Motion" setting is on — one store for the whole app
 * (polish/motion-spec.md §4.1, Wave 3 lane C0).
 *
 * Used to strip decorative motion — the heart burst, the tab snap — and to
 * stop video from autoplaying, which WCAG 2.2 SC 2.2.2 requires for any motion
 * that runs longer than five seconds without a pause control. Under Reduce
 * Motion spatial moves jump to their end, effects become `REDUCED.fadeMs`
 * fades, loops stop; haptics stay (direction › Motion).
 *
 * The store starts SYNCHRONOUSLY from reanimated's launch value, so the very
 * first frame already honours the setting (the old per-instance hook started
 * `false` and animated that frame for a member who asked for less motion).
 * One `AccessibilityInfo` subscription (RN-web: `prefers-reduced-motion`)
 * keeps it live for every reader, however many PressableScales are mounted.
 *
 * API: `useReducedMotion()` (unchanged), plus `getReducedMotion()` and
 * `subscribeReducedMotion(listener)` for code outside React.
 *
 * reactnative.dev no longer serves the 0.74 docs — every /docs/0.74/** path 404s
 * — so the version-pinned citation points at the archive that still does.
 *
 * src: https://reactnative-archive-august-2025.netlify.app/docs/0.74/accessibilityinfo · react-native 0.74.5 · 2026-08-05
 * src: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html · WCAG 2.2 · 2026-08-02
 * src: node_modules/react-native-reanimated/src/reanimated2/hook/useReducedMotion.ts · 3.10.1 · 2026-10-23
 */

function launchValue(): boolean {
  try {
    // A partial jest mock of reanimated may not carry it: stay `false`.
    return typeof reanimatedLaunchValue === 'function' ? Boolean(reanimatedLaunchValue()) : false;
  } catch {
    return false;
  }
}

let current = launchValue();
let started = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

/** One platform subscription for the app's lifetime, opened on first use. */
function ensureStarted(): void {
  if (started) return;
  started = true;
  try {
    AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => set(Boolean(enabled)));
    // Jest's RN mock can return undefined instead of a Promise: a missing
    // answer keeps the launch value.
    void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled())
      .then((enabled) => {
        if (typeof enabled === 'boolean') set(enabled);
      })
      .catch(() => {});
  } catch {
    // No AccessibilityInfo (static render): the launch value stands.
  }
}

/** The current setting, outside React. */
export function getReducedMotion(): boolean {
  ensureStarted();
  return current;
}

/** Called whenever the setting flips. Returns the unsubscribe. */
export function subscribeReducedMotion(listener: () => void): () => void {
  ensureStarted();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, getReducedMotion);
}
