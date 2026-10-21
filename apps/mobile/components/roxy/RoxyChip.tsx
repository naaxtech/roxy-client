import { StyleSheet, Text } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { MARGIN, RADII } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { PressableScale } from '../ui/PressableScale';

/**
 * A suggestion she can tap instead of typing (Hello, Roxy and after Roxy AI's
 * replies). At rest a `raised` pill (chips at rest, design direction v2 ›
 * Color); pressed, it morphs to a rounded square (PressableScale's pill
 * morph, M3 button groups) and fills `pinkContainer` with `onPinkContainer`
 * ink — the selection treatment, never pink text on the container.
 */
export function RoxyChip({
  label, onPress, disabled = false, testID,
}: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const colors = useThemeColors();
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.chip, { backgroundColor: pressed ? colors.pinkContainer : colors.raised }]}
    >
      {({ pressed }) => (
        <Text style={[s.label, { color: pressed ? colors.onPinkContainer : colors.ink }]}>{label}</Text>
      )}
    </PressableScale>
  );
}

const s = StyleSheet.create({
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: MARGIN,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...TYPE.label },
});
