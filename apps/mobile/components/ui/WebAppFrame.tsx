import React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';

/**
 * Desktop-web presentation frame: centers the app as a phone-proportioned
 * column over a soft brand backdrop (the Instagram/Bumble web pattern).
 * Renders children untouched on native and on phone-width browsers, so it
 * costs nothing where the column already fills the viewport.
 */
export function WebAppFrame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const colors = useThemeColors();

  if (Platform.OS !== 'web' || width <= FRAME_MAX_WIDTH) {
    return <>{children}</>;
  }

  return (
    <View style={[styles.backdrop, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={['rgba(255,106,46,0.16)', 'rgba(232,28,142,0.10)', 'rgba(122,28,232,0.16)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          styles.column,
          {
            backgroundColor: colors.background,
            borderColor: 'rgba(255,255,255,0.08)',
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: FRAME_MAX_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    // Web-only frame: RN shadow props map to CSS box-shadow here.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 40,
    overflow: 'hidden',
  },
});
