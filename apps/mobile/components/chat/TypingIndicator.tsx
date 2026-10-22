import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPRING } from '../../lib/motion';

interface TypingIndicatorProps {
  partnerName: string;
  visible: boolean;
  /** Groups: a full line ("Ana and Bea are typing") replaces "<name> is typing". */
  label?: string;
}

/** One dot's rhythm: rise, settle, rest; the three are staggered by STAGGER. */
const CYCLE_REST_MS = 600;
const STAGGER_MS = 150;
const LIFT = 5;
const GROW = 0.45;

/**
 * "<name> is typing…" with three bobbing dots (motion spec §3.1 #10).
 *
 * The dots run on reanimated (UI thread) with `SPRING` tokens: up on
 * `fastSpatial` (small control), down on `fastEffects` (no overshoot), so a
 * busy JS thread cannot stutter them. Under Reduce Motion the loop never
 * starts: the dots are static and the words still say who is typing (F12:
 * loops are static).
 */
export function TypingIndicator({ partnerName, visible, label }: TypingIndicatorProps) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  const dot3 = useSharedValue(0);

  useEffect(() => {
    if (!visible || reduced) return undefined;
    const bob = (dot: SharedValue<number>, delay: number) => {
      dot.value = withRepeat(
        withSequence(
          withDelay(delay, withSpring(1, SPRING.fastSpatial)),
          withSpring(0, SPRING.fastEffects),
          withDelay(CYCLE_REST_MS - delay, withSpring(0, SPRING.fastEffects)),
        ),
        -1,
      );
    };
    bob(dot1, 0);
    bob(dot2, STAGGER_MS);
    bob(dot3, STAGGER_MS * 2);
    return () => {
      [dot1, dot2, dot3].forEach((d) => {
        cancelAnimation(d);
        d.value = 0;
      });
    };
  }, [visible, reduced, dot1, dot2, dot3]);

  const style1 = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + dot1.value * GROW }, { translateY: -dot1.value * LIFT }],
  }));
  const style2 = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + dot2.value * GROW }, { translateY: -dot2.value * LIFT }],
  }));
  const style3 = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + dot3.value * GROW }, { translateY: -dot3.value * LIFT }],
  }));

  // Built once per theme, not on every render (jank audit #8).
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      marginHorizontal: 16,
      marginBottom: 6,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 16,
      borderBottomLeftRadius: 6,
      backgroundColor: colors.surface,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
    },
    name: { color: colors.primary, fontSize: 12, fontWeight: '600' },
    isTyping: { color: colors.textMuted, fontSize: 12 },
    dot: { color: colors.textMuted, fontSize: 16, lineHeight: 18 },
  }), [colors]);

  if (!visible) return null;

  return (
    <View style={styles.container} accessibilityLiveRegion="polite" accessibilityLabel={label ?? `${partnerName} is typing`}>
      {label ? (
        <Text style={styles.isTyping}>{label}</Text>
      ) : (
        <>
          <Text style={styles.name}>{partnerName}</Text>
          <Text style={styles.isTyping}> is typing</Text>
        </>
      )}
      <Animated.Text style={[styles.dot, style1]}>.</Animated.Text>
      <Animated.Text style={[styles.dot, style2]}>.</Animated.Text>
      <Animated.Text style={[styles.dot, style3]}>.</Animated.Text>
    </View>
  );
}
