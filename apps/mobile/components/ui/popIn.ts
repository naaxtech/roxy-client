import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

/**
 * Snappy pop-in for modal content: fast spring scale that settles with at
 * most one barely-perceptible overshoot — pop, not bounce, not fade
 * (Nicole: no slide-up drawers, no springy wobble). Apply the returned style
 * to the modal's content container inside a transparent fade Modal.
 */
export function usePopIn(visible: boolean) {
  const scale = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    if (visible) {
      scale.setValue(0.94);
      Animated.spring(scale, {
        toValue: 1,
        friction: 8,
        tension: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, scale]);

  return { transform: [{ scale }] };
}
