import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE, emphasized } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import type { ArchiveSort } from '../../lib/archive';

interface Props {
  value: ArchiveSort;
  onChange: (value: ArchiveSort) => void;
  testID?: string;
}

const OPTIONS: { key: ArchiveSort; label: string }[] = [
  { key: 'top', label: 'Top rated' },
  // The contribution path. With a young catalogue this is the most useful sort
  // in the app: it says which titles are still waiting for their first rating.
  { key: 'needs', label: 'Needs ratings' },
  { key: 'voted', label: 'Most voted' },
  { key: 'newest', label: 'Newest' },
];

/**
 * The sort row.
 *
 * The selected sort is QUIET: a `raised` fill and the emphasized label. The
 * type row above carries the v2 selection fill (`pinkContainer`), and two
 * pink rows stacked would compete for the same attention — sort is the
 * secondary decision. The label reads "Sort by" in sentence case (v0 had a
 * tracked-caps SORT eyebrow, banned in v2).
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · behaviour 2001 · 2026-09-01
 */
export function SortChips({ value, onChange, testID = 'archive-sort-chips' }: Props) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    // Scrolls sideways instead of cropping the last option (v2 › Worldwide:
    // chip rows scroll when a translation runs long). flexGrow/Shrink 0 for
    // the same react-native-web reason as the type row.
    scroller: { flexGrow: 0, flexShrink: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
    // Sentence case, no tracked caps (v2 › Typography rules).
    heading: { ...TYPE.meta, color: colors.ink3 },
    chip: {
      justifyContent: 'center',
      paddingHorizontal: 12,
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: RADII.pill,
      backgroundColor: 'transparent',
    },
    // The quieter selection: `raised` with the emphasized label, so the sort
    // row never outranks the type row's pinkContainer.
    chipOn: { backgroundColor: colors.raised },
    label: { ...TYPE.label, color: colors.ink2 },
    labelOn: { ...emphasized('label'), color: colors.ink },
  });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.scroller}
      contentContainerStyle={s.row}
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel="Sort the Archive"
    >
      <Text style={s.heading}>Sort by</Text>
      {OPTIONS.map((option) => {
        const selected = value === option.key;
        return (
          <PressableScale key={option.key} onPress={() => onChange(option.key)} accessible={false}>
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
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
