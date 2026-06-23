import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useThemeStore } from '../../store/themeStore';

const TRACK_W = 72;
const TRACK_H = 36;
const THUMB_SIZE = 28;
const THUMB_TRAVEL = TRACK_W - THUMB_SIZE - 8; // 36px

export function ThemeToggle() {
  const { theme, setTheme } = useThemeStore();
  const isDark = theme === 'dark';

  const anim = useRef(new Animated.Value(isDark ? 0 : 1)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: isDark ? 0 : 1,
      useNativeDriver: true,
      tension: 260,
      friction: 18,
    }).start();
  }, [isDark]);

  const thumbX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [4, THUMB_TRAVEL],
  });

  const trackColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#2d1b4e', '#C4B5FF'],
  });

  const toggle = () => void setTheme(isDark ? 'light' : 'dark');

  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: !isDark }}
      accessibilityLabel={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
        {/* Moon icon - left side */}
        <Text style={[styles.icon, styles.iconLeft]}>🌙</Text>
        {/* Sun icon - right side */}
        <Text style={[styles.icon, styles.iconRight]}>☀️</Text>

        {/* Sliding thumb */}
        <Animated.View
          style={[
            styles.thumb,
            { transform: [{ translateX: thumbX }] },
          ]}
        >
          <Text style={styles.thumbIcon}>{isDark ? '🌙' : '☀️'}</Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  icon: {
    position: 'absolute',
    fontSize: 14,
    top: (TRACK_H - 20) / 2,
  },
  iconLeft: { left: 8 },
  iconRight: { right: 8 },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  thumbIcon: {
    fontSize: 14,
    lineHeight: 18,
  },
});
