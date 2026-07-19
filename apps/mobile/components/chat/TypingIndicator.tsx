import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

interface TypingIndicatorProps {
  partnerName: string;
  visible: boolean;
}

export function TypingIndicator({ partnerName, visible }: TypingIndicatorProps) {
  const colors = useThemeColors();
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    const anim = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ])
      );
    const a1 = anim(dot1, 0);
    const a2 = anim(dot2, 150);
    const a3 = anim(dot3, 300);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [visible, dot1, dot2, dot3]);

  if (!visible) return null;

  const dotStyle = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
  });

  const styles = StyleSheet.create({
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
  });

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{partnerName}</Text>
      <Text style={styles.isTyping}> is typing</Text>
      <Animated.Text style={[styles.dot, dotStyle(dot1)]}>.</Animated.Text>
      <Animated.Text style={[styles.dot, dotStyle(dot2)]}>.</Animated.Text>
      <Animated.Text style={[styles.dot, dotStyle(dot3)]}>.</Animated.Text>
    </View>
  );
}
