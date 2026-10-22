import { Platform } from 'react-native';

/**
 * Props that make a raw RN `Pressable` answer on press-in with no delay on
 * every platform (budget F1). RN-web's Pressable waits `delayPressIn` (50 ms
 * by default, and measured 110-180 ms to the first visible change through its
 * touch path) before press-in; native's waits nothing. `PressableScale`
 * already does this; spread it on the few raw Pressables that draw their own
 * press state (PrimaryButton's lip, Switch's thumb, the tucked Roxy O).
 * Read at render, so a test can switch `Platform.OS`.
 */
export function noPressDelay(): Record<string, number> {
  return Platform.OS === 'web' ? { delayPressIn: 0 } : {};
}
