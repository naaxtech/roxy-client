import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { loadRoxyHaptics } from '../modules/roxy-haptics';
import type { AndroidHapticName } from '../modules/roxy-haptics';

/**
 * One haptics module for the whole app. The contract is the haptic map in
 * polish/motion-spec.md §3.3 (decisions 2026-10-23, P3 and P4):
 *
 * | kind        | fires on                                                        |
 * |-------------|-----------------------------------------------------------------|
 * | `selection` | tab change; chip, segment, theme or radio choice; each emoji    |
 * |             | passed in the picker; swipe-to-reply threshold; a long-press    |
 * |             | that opens a menu or picker; pull-to-refresh threshold          |
 * | `light`     | committed reaction; FAB -> Roxy AI; switch toggled              |
 * | `medium`    | RSVP seal lands                                                 |
 * | `success`   | "You're in"                                                     |
 *
 * Everything else (send, follow, save, poll vote, comment like, accept request, errors,
 * scroll, keystrokes) has no haptic. `__tests__/feel/feelGate.test.ts` holds every call
 * site to that table.
 *
 * Rules:
 *   - Never on web.
 *   - Haptics stay under Reduce Motion (the direction). The old `reducedMotion` argument is
 *     still accepted so Wave 1/2 call sites compile, and is ignored.
 *   - Android plays through the local `RoxyHaptics` module (`View.performHapticFeedback`), so
 *     the phone's "Touch feedback" setting is honoured. When that module is missing (an
 *     installed build older than it, Expo Go) Android falls back to expo-haptics, which is what
 *     every build did before. When the module is there but the system declines (touch feedback
 *     off), nothing else plays.
 *   - iOS uses expo-haptics (UIFeedbackGenerator follows the system haptics switch).
 *   - Every call is fire-and-forget and never throws into a gesture handler: a haptic is
 *     decoration, the action it decorates must not fail with it.
 *
 * History: Wave 1/2 merged the chat lane's `haptic(kind)` and the feed lane's
 * `tapLight()`/`celebrate()` here; both stay callable as aliases (below).
 */

/** The four kinds of the haptic map (§3.3). */
export type HapticKind = 'selection' | 'light' | 'medium' | 'success';

/**
 * Wave 1/2 names, kept callable while the owner lanes move their call sites onto §3.3:
 * `tap` is `light`, `select` is `selection`. `warning` is outside §3.3 ("errors never buzz");
 * its one call site is on the removal list.
 * @deprecated Use a {@link HapticKind}.
 */
export type LegacyHapticKind = 'tap' | 'select' | 'warning';

type Resolved = HapticKind | 'warning';

const LEGACY: Record<LegacyHapticKind, Resolved> = { tap: 'light', select: 'selection', warning: 'warning' };

function resolve(kind: HapticKind | LegacyHapticKind): Resolved {
  return (LEGACY as Record<string, Resolved | undefined>)[kind] ?? (kind as HapticKind);
}

/**
 * The `HapticFeedbackConstants` name for a kind on an Android API level (§3.3, Android column).
 * SEGMENT_TICK arrived in API 34 (Android 14), CONFIRM and REJECT in API 30 (Android 11).
 * Below API 30 `success` uses LONG_PRESS like `medium`: §3.3 names only CONFIRM, and LONG_PRESS
 * is the system's own firm tick, still subject to the Touch feedback setting.
 */
export function androidHapticFor(kind: HapticKind | 'warning', apiLevel: number): AndroidHapticName {
  switch (kind) {
    case 'selection':
      return apiLevel >= 34 ? 'SEGMENT_TICK' : 'CLOCK_TICK';
    case 'light':
      return 'CONTEXT_CLICK';
    case 'medium':
    case 'success':
      return apiLevel >= 30 ? 'CONFIRM' : 'LONG_PRESS';
    case 'warning':
      return apiLevel >= 30 ? 'REJECT' : 'LONG_PRESS';
  }
}

/** iOS (and the Android fallback): the expo-haptics call for a kind. */
function expoHaptic(kind: Resolved): Promise<void> {
  switch (kind) {
    case 'selection':
      return Haptics.selectionAsync();
    case 'light':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    case 'medium':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    case 'success':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    case 'warning':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }
}

function androidApiLevel(): number {
  const v = Platform.Version as number | string;
  return typeof v === 'number' ? v : Number.parseInt(String(v), 10) || 0;
}

function quietly(p: Promise<unknown> | undefined): void {
  void p?.catch?.(() => undefined);
}

/**
 * Play one haptic of `kind` (§3.3). No-op on web; fires under Reduce Motion.
 * @param _reducedMotion Ignored: haptics stay under Reduce Motion. Kept for old call sites.
 */
export function haptic(kind: HapticKind | LegacyHapticKind, _reducedMotion?: boolean): void {
  if (Platform.OS === 'web') return;
  const k = resolve(kind);
  try {
    if (Platform.OS === 'android') {
      const native = loadRoxyHaptics();
      if (native) {
        quietly(native.perform(androidHapticFor(k, androidApiLevel())));
        return;
      }
    }
    quietly(expoHaptic(k));
  } catch {
    // No engine / no activity / no native module in this client. Nothing to do.
  }
}

/**
 * `light`: a committed reaction, the FAB opening Roxy AI, a switch toggled.
 * @deprecated Wave 1/2 name; use `haptic('light')`. The argument is ignored.
 */
export function tapLight(_reducedMotion?: boolean): void {
  haptic('light');
}

/**
 * `success`: "You're in" only (§3.3).
 * @deprecated Wave 1/2 name; use `haptic('success')`. The argument is ignored.
 */
export function celebrate(_reducedMotion?: boolean): void {
  haptic('success');
}
