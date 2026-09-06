import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the OS "Reduce Motion" setting is on.
 *
 * Used to strip decorative motion — the heart burst, the tab crossfade — and to
 * stop video from autoplaying, which WCAG 2.2 SC 2.2.2 requires for any motion
 * that runs longer than five seconds without a pause control.
 *
 * Starts `false`: the platform answers asynchronously, and defaulting to `true`
 * would blank the first frame of every animation for users who never asked for
 * that.
 *
 * reactnative.dev no longer serves the 0.74 docs — every /docs/0.74/** path 404s
 * — so the version-pinned citation points at the archive that still does.
 *
 * src: https://reactnative-archive-august-2025.netlify.app/docs/0.74/accessibilityinfo · react-native 0.74.5 · 2026-08-05
 * src: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html · WCAG 2.2 · 2026-08-02
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduced(enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (mounted) setReduced(enabled);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
