package expo.modules.roxyhaptics

import android.os.Build
import android.view.HapticFeedbackConstants
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * RoxyHaptics: plays one system haptic through `View.performHapticFeedback` on the current
 * activity's decor view (polish/motion-spec.md §3.3, §4.1; decision P4).
 *
 * expo-haptics 13 drives `Vibrator` directly, which ignores the phone's "Touch feedback"
 * setting. `performHapticFeedback` without `FLAG_IGNORE_GLOBAL_SETTING` is the path Android's
 * own controls use, so a member who turned touch feedback off feels nothing.
 *
 * The JS side (`lib/haptics.ts`, `androidHapticFor`) picks the constant per kind and API level
 * and sends its name; this module maps the name to the SDK int and plays it on the main thread.
 */
class RoxyHapticsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RoxyHaptics")

    // Resolves true when the system played it, false when it declined: Touch feedback off,
    // a constant this API level lacks, an unknown name, or no activity on screen.
    AsyncFunction("perform") { name: String ->
      val constant = feedbackConstant(name, Build.VERSION.SDK_INT) ?: return@AsyncFunction false
      val view = appContext.currentActivity?.window?.decorView ?: return@AsyncFunction false
      view.performHapticFeedback(constant)
    }.runOnQueue(Queues.MAIN)
  }
}

/** The `HapticFeedbackConstants` int for a name the JS sends, or null below its API level. */
internal fun feedbackConstant(name: String, sdk: Int): Int? = when (name) {
  "CLOCK_TICK" -> HapticFeedbackConstants.CLOCK_TICK
  "CONTEXT_CLICK" -> HapticFeedbackConstants.CONTEXT_CLICK
  "LONG_PRESS" -> HapticFeedbackConstants.LONG_PRESS
  "CONFIRM" -> if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else null
  "REJECT" -> if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT else null
  "SEGMENT_TICK" -> if (sdk >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) HapticFeedbackConstants.SEGMENT_TICK else null
  else -> null
}
