import { View, Text, StyleSheet } from 'react-native';
import { PrimaryButton } from './PrimaryButton';
import { useThemeColors } from '../../hooks/useThemeColors';

type Props = {
  emoji: string;
  title: string;
  body?: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
};

/**
 * Standard centered empty state: emoji, title, body, optional CTA. The CTA is
 * the screen's one primary action, so it is the v2 PrimaryButton (with lip).
 */
export function EmptyState({ emoji, title, body, ctaLabel, onCtaPress }: Props) {
  const colors = useThemeColors();
  const styles = StyleSheet.create({
    wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
    emoji: { fontSize: 46 },
    title: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    body: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 21 },
    cta: { alignSelf: 'center', marginTop: 4 },
  });
  return (
    <View style={styles.wrap}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {ctaLabel && onCtaPress ? (
        <PrimaryButton style={styles.cta} label={ctaLabel} onPress={onCtaPress} />
      ) : null}
    </View>
  );
}
