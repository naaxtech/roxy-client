import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

export interface Chip<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  chips: readonly Chip<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Screen-reader name for the group, e.g. "Filter events". */
  label: string;
  /** The bigger top-level row reads heavier than an in-rail row. */
  emphasis?: 'primary' | 'inline';
  testID?: string;
}

/**
 * A single-choice chip row.
 *
 * `accessibilityRole="radio"` inside a `radiogroup`, not "button": exactly one
 * chip is always on, and a screen reader should say so rather than announcing
 * six unrelated buttons and leaving her to infer the relationship.
 *
 * The selected chip is marked by fill AND by its accessibility state. The two
 * emphases differ only in weight — a filter row inside a rail must not compete
 * with the row that decides which rails exist.
 */
export function FilterChips<T extends string>({
  chips, value, onChange, label, emphasis = 'inline', testID,
}: Props<T>) {
  const colors = useThemeColors();
  const s = styles(colors);
  const primary = emphasis === 'primary';

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
    >
      {chips.map((chip) => {
        const on = chip.key === value;
        const fill = primary ? colors.primary : colors.surfaceLight;
        return (
          <TouchableOpacity
            key={chip.key}
            testID={testID ? `${testID}-${chip.key}` : undefined}
            onPress={() => onChange(chip.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            accessibilityLabel={chip.label}
            activeOpacity={0.8}
            style={[
              s.chip,
              on
                ? { backgroundColor: fill, borderColor: fill }
                : { backgroundColor: colors.surface, borderColor: colors.line },
            ]}
          >
            <Text
              style={[
                primary ? s.labelPrimary : s.labelInline,
                { color: on ? inkOn(fill) : colors.textSecondary },
              ]}
            >
              {chip.label}
            </Text>
          </TouchableOpacity>
        );
      })}
      {/* Trailing breathing room so the last chip is not flush with the edge. */}
      <View style={s.tail} />
    </ScrollView>
  );
}

// Every colour on a chip depends on its selected state, so it is applied
// inline; only the geometry is static.
const styles = (_colors: ThemeColors) => StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 16, alignItems: 'center' },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  labelPrimary: { ...TYPE.bodyLg, fontWeight: '700' },
  labelInline: { ...TYPE.caption, fontWeight: '600' },
  tail: { width: 4 },
});
