import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAccess } from '../../hooks/useAccess';
import { useViewAsStore } from '../../store/viewAsStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { ACCOUNT_KIND_LABEL } from '../../lib/features';
import { TYPE } from '../../lib/typography';
import { RADII, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

export function ViewAsBanner() {
  const colors = useThemeColors();
  const router = useRouter();
  const { isPreviewing, kind } = useAccess();
  const setPreview = useViewAsStore((s) => s.setPreview);
  const s = styles(colors);

  if (!isPreviewing) return null;

  return (
    <TouchableOpacity
      style={s.bar}
      onPress={() => {
        setPreview(null);
        if (kind === 'pending') router.replace('/(tabs)/feed' as never);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Viewing as ${ACCOUNT_KIND_LABEL[kind]}. Return to Roxy core`}
      testID="view-as-banner"
    >
      <Text style={s.text}>Viewing as {ACCOUNT_KIND_LABEL[kind]} · tap to leave</Text>
    </TouchableOpacity>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    minHeight: MIN_TOUCH_TARGET - 8,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: RADII.sm,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  text: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '700' },
});
