import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

type Props = {
  emoji: string;
  title: string;
  body?: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
};

/** Standard centered empty state: emoji, title, body, optional roxy CTA pill. */
export function EmptyState({ emoji, title, body, ctaLabel, onCtaPress }: Props) {
  const colors = useThemeColors();
  const styles = StyleSheet.create({
    wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
    emoji: { fontSize: 46 },
    title: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    body: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 21 },
    cta: {
      backgroundColor: colors.roxy,
      borderRadius: 22,
      paddingHorizontal: 22,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  });
  return (
    <View style={styles.wrap}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {ctaLabel && onCtaPress ? (
        <TouchableOpacity style={styles.cta} onPress={onCtaPress} accessibilityLabel={ctaLabel}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
