import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import type { ArchiveMediaType } from '../../lib/archive';

interface Props {
  value: ArchiveMediaType | null;
  onChange: (value: ArchiveMediaType | null) => void;
  testID?: string;
}

/**
 * The type filter.
 *
 * "All" is `null`, not a seventh media type. The query takes
 * `mediaType: ArchiveMediaType | null` and omits the `.eq()` entirely when it is
 * null — modelling "All" as a string would mean either a fake enum member the
 * database rejects, or a magic value every call site has to remember to strip.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · behaviour 2000 · 2026-09-01
 */
const OPTIONS: { key: string; label: string; value: ArchiveMediaType | null }[] = [
  { key: 'all', label: 'All', value: null },
  { key: 'film', label: 'Film', value: 'film' },
  { key: 'tv', label: 'TV', value: 'tv' },
  { key: 'book', label: 'Book', value: 'book' },
  { key: 'comic', label: 'Comic', value: 'comic' },
  { key: 'music', label: 'Music', value: 'music' },
];

export function MediaTypeChips({ value, onChange, testID = 'archive-type-chips' }: Props) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    row: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
    chip: {
      justifyContent: 'center',
      paddingHorizontal: 14,
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: RADII.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.surface,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    label: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' },
    labelOn: { color: inkOn(colors.primary) },
  });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel="Filter the Archive by type"
    >
      {OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable key={option.key} onPress={() => onChange(option.value)} accessible={false}>
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
    </ScrollView>
  );
}
