/**
 * How big a thing you can tap has to be, and where the numbers come from.
 *
 * This lives in `lib/` rather than in `components/nav/navTokens.ts` (where it
 * started) or in `components/feed/feedChromeTokens.ts` because it is a platform
 * fact, not a navigation fact or a feed fact. It had already been stated as
 * doctrine in one file and broken in the other; a second private copy would have
 * guaranteed a third.
 *
 * ## `hitSlop` is not a touch target
 *
 * React Native's `hitSlop` never extends a touch area past the PARENT's bounds,
 * and Google's Accessibility Test Framework measures the view's own bounds — so
 * a 32dp icon with 12dp of `hitSlop` reads as a 32dp target to the platform, to
 * TalkBack, and to the Play Console pre-launch report. Size the view instead.
 *
 * src: https://reactnative-archive-august-2025.netlify.app/docs/0.74/view#hitslop · react-native 0.74.5 · 2026-08-07
 */

/**
 * The floor for a standalone control — anything icon-only, anything with a plate
 * of its own, anything that is not a word inside a sentence.
 *
 * 48, not 44. `TouchTargetSizeCheck`, the check that actually runs against a
 * Roxy build in the Play Console pre-launch report, hardcodes
 * `TOUCH_TARGET_MIN_HEIGHT = 48` and `TOUCH_TARGET_MIN_WIDTH = 48` (32 only for
 * views against the display edge or inside an IME window). The 44 this project
 * shipped is Apple's HIG number and WCAG's Level AAA SC 2.5.5 number; it was
 * cited to ATF, which says 48.
 *
 * src: https://github.com/google/Accessibility-Test-Framework-for-Android/blob/master/src/main/java/com/google/android/apps/common/testing/accessibility/framework/checks/TouchTargetSizeCheck.java · TOUCH_TARGET_MIN_HEIGHT/WIDTH = 48 · 2026-08-07
 * src: https://support.google.com/accessibility/android/answer/7101858 · 2026-08-07
 */
export const MIN_TOUCH_TARGET = 48;

/**
 * The floor for a target that is a word inside a block of text.
 *
 * WCAG 2.2 SC 2.5.8 (Level AA) asks for 24×24 CSS pixels and then names the
 * exception this constant exists for: **"Inline: The target is in a sentence or
 * its size is otherwise constrained by the line-height of non-target text."**
 * The feed's identity block — the handle, the "more" affordance, the community
 * line — is exactly that: three text links stacked in a paragraph whose height
 * is set by the type.
 *
 * They are held to 24 rather than 48 deliberately. Giving each of them a 48dp
 * box adds ~90dp to a band that is bottom-anchored and auto-height, which on
 * Connect's ~320dp page would veil two thirds of the frame — trading a
 * measurable a11y win for the exact unbounded-scrim failure the chrome's
 * contrast design exists to prevent. What is NOT traded away is `hitSlop`:
 * these are measured too, just measured against the criterion that applies to
 * them.
 *
 * src: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html · WCAG 2.2 SC 2.5.8 · 2026-08-07
 */
export const MIN_INLINE_TOUCH_TARGET = 24;
