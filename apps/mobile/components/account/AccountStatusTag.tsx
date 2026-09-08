import { View, Text, StyleSheet } from 'react-native';
import { useAccess } from '../../hooks/useAccess';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { useThemeColors } from '../../hooks/useThemeColors';

/**
 * Small chip in the top bar. Pending applicants stay in the app; this is
 * how they see their status without a full-screen wait.
 */
export function AccountStatusTag() {
  const colors = useThemeColors();
  const { kind } = useAccess();
  if (kind !== 'pending') return null;
  return (
    <View
      testID="account-status-tag"
      accessibilityRole="text"
      accessibilityLabel="Account status: pending"
      style={[
        styles.tag,
        { backgroundColor: colors.primary + '22', borderColor: colors.primary + '55' },
      ]}
    >
      <Text style={[styles.label, { color: colors.primaryInk }]}>Pending</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  label: {
    ...TYPE.micro,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
