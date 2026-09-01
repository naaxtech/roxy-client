import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import { tintFill, tintLine } from './archiveTokens';
import type { ArchiveSort } from '../../lib/archive';

interface Props {
  value: ArchiveSort;
  onChange: (value: ArchiveSort) => void;
  testID?: string;
}

const OPTIONS: { key: ArchiveSort; label: string }[] = [
  { key: 'top', label: 'Top rated' },
  { key: 'voted', label: 'Most voted' },
  { key: 'newest', label: 'Newest' },
];

/**
 * The sort row.
 *
 * Selected chips are TINTED, not filled. The type row above uses a solid
 * primary fill, and two solid rows stacked would compete for the same
 * attention — the prototype gives sort the quieter treatment because it is the
 * secondary decision. Same tokens, lower commitment.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · behaviour 2001 · 2026-09-01
 */
export function SortChips({ value, onChange, testID = 'archive-sort-chips' }: Props) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
    heading: { ...TYPE.micro, color: colors.textMuted, fontWeight: '800', letterSpacing: 1 },
    chip: {
      justifyContent: 'center',
      paddingHorizontal: 12,
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: RADII.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: 'transparent',
    },
    chipOn: {
      backgroundColor: tintFill(colors, colors.primary),
      borderColor: tintLine(colors, colors.primaryInk),
    },
    label: { ...TYPE.caption, color: colors.textMuted, fontWeight: '700' },
    labelOn: { color: colors.primaryInk },
  });

  return (
    <View
      style={s.row}
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel="Sort the Archive"
    >
      <Text style={s.heading}>SORT</Text>
      {OPTIONS.map((option) => {
        const selected = value === option.key;
        return (
          <Pressable key={option.key} onPress={() => onChange(option.key)} accessible={false}>
      {/* The a11y identity sits on this View, not on the Pressable wrapping it.
          RN's Pressable builds an explicit prop list and DROPS unknown props —
          verified here: a host Pressable receives testID and accessibilityState
          but never `aria-checked`, while a View receives it. Since
          `accessibilityState` alone renders no attribute at all on
          react-native-web 0.19, putting the pair on a View is the only shape
          where BOTH halves survive: native reads accessibilityState, web reads
          aria-checked. The Pressable outside keeps the touch behaviour and is
          marked not-accessible so there is exactly one stop, not two. */}
            <View
              style={[s.chip, selected && s.chipOn]}
              testID={`${testID}-${option.key}`}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              {...a11yState({ checked: selected })}
            >
              <Text style={[s.label, selected && s.labelOn]}>{option.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
