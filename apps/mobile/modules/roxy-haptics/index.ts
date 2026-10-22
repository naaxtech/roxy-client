import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * RoxyHaptics: a local Expo module (Android only) that plays one system haptic through
 * `View.performHapticFeedback` on the activity's decor view.
 *
 * Why it exists (polish/motion-spec.md §1.1, §4.1, decision P4): expo-haptics 13 drives
 * Android's `Vibrator` directly, which ignores the phone's "Touch feedback" setting.
 * `performHapticFeedback` (without FLAG_IGNORE_GLOBAL_SETTING) is the path Android's own
 * controls use, so a member who switched touch feedback off feels nothing.
 *
 * The native side lives in `android-native/` (not `android/`: the repo's `.gitignore` and
 * `.easignore` drop every directory named `android/`, which would keep the Kotlin out of git
 * and out of the EAS upload). `expo-module.config.json` points autolinking at it.
 *
 * iOS keeps expo-haptics (UIFeedbackGenerator already follows the system haptics switch), so
 * the module declares Android only and `loadRoxyHaptics()` is null on iOS and web.
 */

/** The `HapticFeedbackConstants` names the native side accepts (it maps them to the SDK ints). */
export type AndroidHapticName =
  | 'CLOCK_TICK'
  | 'SEGMENT_TICK'
  | 'CONTEXT_CLICK'
  | 'CONFIRM'
  | 'REJECT'
  | 'LONG_PRESS';

export interface RoxyHapticsNativeModule {
  /**
   * Plays the constant on the main thread. Resolves `false` when the system declined (touch
   * feedback off, constant unsupported on this API level, no activity), `true` when it played.
   */
  perform(name: AndroidHapticName): Promise<boolean>;
}

/**
 * The installed module, or `null` when this client does not carry it (web, iOS, Expo Go, an
 * Android build older than the module, the jest runner). Never throws.
 */
export function loadRoxyHaptics(): RoxyHapticsNativeModule | null {
  try {
    return requireOptionalNativeModule<RoxyHapticsNativeModule>('RoxyHaptics') ?? null;
  } catch {
    return null;
  }
}
