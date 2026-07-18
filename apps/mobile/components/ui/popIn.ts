import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

/**
 * Snappy pop-in for modal content: spring scale with a subtle overshoot
 * bounce (Nicole: fades are boring). Apply the returned style to the modal's
 * content container inside a transparent fade Modal.
 */
export function usePopIn(visible: boolean) {
  const scale = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    if (visible) {
      scale.setValue(0.88);
      Animated.spring(scale, {
        toValue: 1,
        friction: 5.5,
        tension: 160,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, scale]);

  return { transform: [{ scale }] };
}
