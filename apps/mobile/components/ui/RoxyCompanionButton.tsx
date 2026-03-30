import React, { useRef, useEffect } from 'react';
import { TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '../../lib/constants';

interface Props {
  visible?: boolean;
}

export function RoxyCompanionButton({ visible = true }: Props) {
  const router = useRouter();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 300, delay: 400, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 300, delay: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  if (!visible) return null;

  const handlePress = () => {
    router.push('/(tabs)/grow/roxy-chat' as any);
  };

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <TouchableOpacity
        testID="fab-button"
        style={styles.button}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        <Ionicons name="sparkles" size={22} color="#FFFFFF" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute', bottom: 90, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.roxy,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 8, zIndex: 1000,
  },
});
