import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Light haptics for the small yeses: a like, a follow, a vote, a post going
 * live (FEED-09).
 *
 * Every call is fire-and-forget and can never throw into a gesture handler:
 * web has no haptics, some Android devices have no vibrator. Callers pass
 * `reducedMotion`; when the OS asked for less motion, we stay still.
 */

/** A soft tick: a like, a follow, a vote. */
export function tapLight(reducedMotion = false): void {
  if (reducedMotion || Platform.OS === 'web') return;
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  } catch {
    // No vibrator, or no native module in this client. A like still counts.
  }
}

/** A bigger "it worked": a post published, a first anything. */
export function celebrate(reducedMotion = false): void {
  if (reducedMotion || Platform.OS === 'web') return;
  try {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  } catch {
    // As above.
  }
}
