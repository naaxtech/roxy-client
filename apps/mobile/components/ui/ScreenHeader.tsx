import { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE, FONTS } from '../../lib/typography';
import { AccountStatusTag } from '../account/AccountStatusTag';

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
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 10,
      gap: 8,
      backgroundColor: colors.backgroundAlt,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    left: { flex: 1 },
    eyebrow: {
      ...TYPE.micro,
      color: colors.textMuted,
      fontWeight: '800',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    title: {
      ...TYPE.headline,
      color: colors.textPrimary,
      fontFamily: FONTS.display.extrabold,
      letterSpacing: -0.2,
    },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  });
  return (
    <View style={styles.header}>
      <View style={styles.left}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      <View style={styles.actions}>
        <AccountStatusTag />
        {actions}
      </View>
    </View>
  );
}
