import { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

type Props = {
  title: string;
  eyebrow?: string;
  /** Right-side actions — round icon buttons or chips supplied by the screen. */
  actions?: ReactNode;
};

/** Standard tab header: eyebrow + big title left, actions right. */
export function ScreenHeader({ title, eyebrow, actions }: Props) {
  const colors = useThemeColors();
  const styles = StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingTop: 6,
      paddingBottom: 12,
      gap: 8,
    },
    left: { flex: 1 },
    eyebrow: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  });
  return (
    <View style={styles.header}>
      <View style={styles.left}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}
