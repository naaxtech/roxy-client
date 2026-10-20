import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * One haptics module for the whole app (merged at integration):
 *   - `haptic(kind)`: chat moments (send, react, long-press, request answered),
 *     from the chat lane;
 *   - `tapLight()` / `celebrate()`: the small yeses (a like, a follow, a vote)
 *     and the big "it worked" (a post live, "You're in"), from the feed lane
 *     (FEED-09), also used by the gate lane's welcome-in screen.
 *
 * Every call is fire-and-forget and can never throw into a gesture handler:
 * web has no haptics engine, some Android devices have no vibrator, and a test
 * runner has no native module. A haptic is decoration: it can fail silently,
 * the action it decorates cannot. Callers that know the OS asked for less
 * motion pass `reducedMotion`; then we stay still.
 */

export type HapticKind = 'tap' | 'select' | 'success' | 'warning';

function fire(start: () => Promise<void> | undefined, reducedMotion: boolean): void {
  if (reducedMotion || Platform.OS === 'web') return;
  try {
    void start()?.catch?.(() => undefined);
  } catch {
    // No engine / no native module in this client. Nothing to do.
  }
}

/** Chat haptics by kind. `tap` is a light impact. */
export function haptic(kind: HapticKind = 'tap', reducedMotion = false): void {
  fire(() => {
    if (kind === 'select') return Haptics.selectionAsync();
    if (kind === 'success') return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (kind === 'warning') return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, reducedMotion);
}

/** A soft tick: a like, a follow, a vote. */
export function tapLight(reducedMotion = false): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), reducedMotion);
}

/** A bigger "it worked": a post published, a first anything. */
export function celebrate(reducedMotion = false): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), reducedMotion);
}
