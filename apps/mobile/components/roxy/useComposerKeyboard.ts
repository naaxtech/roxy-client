import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useAnimatedKeyboard, useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * How far the on-screen keyboard covers the bottom of the screen, as a shared
 * value the UI thread reads every frame (motion spec §3.1 row 15, F14).
 *
 * Native: reanimated's `useAnimatedKeyboard`, which follows the keyboard's own
 * animation frame by frame. While it is mounted it turns Android's
 * `adjustResize` off for the whole app (reanimated docs), so mount it only on
 * a chat screen that lays itself out from this value (Roxy AI's chat today).
 * Below Android 11 the height arrives at the end of the animation, not during.
 *
 * Web: the keyboard shrinks only the visual viewport (iOS Safari, Chrome on
 * Android since 108), so a composer docked to the layout viewport's bottom
 * would sit under it. The overlap is read from `visualViewport` (±1 px).
 */
export function keyboardOverlap(
  innerHeight: number,
  vv: { height: number; offsetTop: number; scale?: number },
): number {
  // Pinch-zoom also shrinks the visual viewport; that is not a keyboard.
  if (vv.scale !== undefined && Math.abs(vv.scale - 1) > 0.01) return 0;
  return Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
}

export function useNativeComposerKeyboard(): SharedValue<number> {
  return useAnimatedKeyboard().height;
}

export function useWebComposerKeyboard(): SharedValue<number> {
  const height = useSharedValue(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    const update = () => {
      height.value = keyboardOverlap(window.innerHeight, vv);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [height]);
  return height;
}

/** The platform's form, chosen once (a platform never changes at runtime). */
export const useComposerKeyboard: () => SharedValue<number> =
  Platform.OS === 'web' ? useWebComposerKeyboard : useNativeComposerKeyboard;
