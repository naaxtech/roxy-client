import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

interface NewPostsBannerProps {
  count: number;
  onPress: () => void;
}

export function NewPostsBanner({ count, onPress }: NewPostsBannerProps) {
  const colors = useThemeColors();

  const styles = StyleSheet.create({
    banner: {
      position: 'absolute',
      top: 12,
      alignSelf: 'center',
      backgroundColor: colors.primary,
      paddingVertical: 8,
      paddingHorizontal: 18,
      borderRadius: 20,
      zIndex: 10,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 6,
    },
    text: { color: '#fff', fontWeight: '700', fontSize: 14 },
  });

  if (count === 0) return null;
  return (
    <TouchableOpacity
      testID="new-posts-banner"
      style={styles.banner}
      onPress={onPress}
      accessibilityLabel={`${count} new post${count === 1 ? '' : 's'}, tap to load`}
    >
      <Text style={styles.text}>
        ↑  {count} new post{count === 1 ? '' : 's'}
      </Text>
    </TouchableOpacity>
  );
}
