import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Haptic ticks for chat moments (send, react, long-press, request answered).
 *
 * Guarded twice: web has no haptics engine, and a device without one (or a
 * test runner) must never turn a tap into an error. A haptic is decoration —
 * it can fail silently, the action it decorates cannot.
 */
type Kind = 'tap' | 'select' | 'success' | 'warning';

export function haptic(kind: Kind = 'tap'): void {
  if (Platform.OS === 'web') return;
  try {
    let p: Promise<void> | undefined;
    if (kind === 'select') p = Haptics.selectionAsync();
    else if (kind === 'success') p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === 'warning') p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void p?.catch?.(() => {});
  } catch {
    // no engine — nothing to do
  }
}
