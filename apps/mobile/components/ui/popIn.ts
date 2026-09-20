import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { POP_FROM, SNAP_SPRING, popInStyle } from '../../lib/motion';

/**
 * Snappy pop-in for modal content: fast spring scale with at most one
 * barely-perceptible overshoot. Never fades. Apply the returned style to the
 * modal's content inside `animationType="none"` so the backdrop is instant.
 */
export function usePopIn(visible: boolean) {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(POP_FROM)).current;

  useEffect(() => {
    if (!visible) return;
    if (reducedMotion) {
      scale.setValue(1);
      return;
    }
    scale.setValue(POP_FROM);
    Animated.spring(scale, { toValue: 1, ...SNAP_SPRING }).start();
  }, [visible, reducedMotion, scale]);

  return popInStyle(scale);
}
