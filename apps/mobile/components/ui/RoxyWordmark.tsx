import { StyleSheet, View, ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

type Props = {
  /** 'primary' (color, light surfaces) or 'white' (gradient/dark surfaces). */
  variant?: 'primary' | 'white';
  height?: number;
  style?: ViewStyle;
};

/**
 * The Roxy logo wordmark. Brand rule: every screen with a brand header uses
 * this asset — never a plain-text "Roxy" heading. The white variant needs
 * tintColor because the source SVG ships without fill attributes.
 */
export function RoxyWordmark({ variant = 'primary', height = 44, style }: Props) {
  const source = variant === 'white'
    ? require('../../assets/brand/roxy-logo-mono-white.svg')
    : require('../../assets/brand/roxy-logo-primary.svg');
  return (
    <View style={[styles.wrap, style]}>
      <ExpoImage
        source={source}
        style={{ width: height * 2.6, height }}
        contentFit="contain"
        tintColor={variant === 'white' ? '#FFFFFF' : undefined}
        accessibilityLabel="Roxy"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
});
