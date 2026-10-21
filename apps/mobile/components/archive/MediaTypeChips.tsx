import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TABULAR, TYPE, emphasized } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import {
  ARCHIVE_TYPE_FILTERS, archiveTypeLabel, filterCount,
  type TypeCounts,
} from '../../lib/archiveTypes';
import type { ArchiveMediaType } from '../../lib/archive';

interface Props {
  value: ArchiveMediaType | null;
  onChange: (value: ArchiveMediaType | null) => void;
  /** Published entries per type. Omit and the chips render without counts. */
  counts?: TypeCounts;
  testID?: string;
}

/** The painted pill's height. The TARGET is MIN_TOUCH_TARGET; this is the ink. */
const PILL_HEIGHT = 34;

/**
 * The Archive's type filter.
 *
 * Two things were wrong with the first version. It used the enum's own words —
 * Film, TV, Comic — which is how the database talks, not how a woman deciding
 * what to watch tonight talks. And every pill was `minHeight: MIN_TOUCH_TARGET`,
 * so a 44pt slab carried an 11px word: correct by the letter of the
 * touch-target rule, and heavy enough that two stacked filter rows crowded the
 * results off the screen.
 *
 * The fix for the second is the distinction the rule is actually about. The
 * PRESSABLE is 44pt tall — all of it responds to a finger, measured, not
 * hit-slopped. The pill inside is 34pt and is only paint. She gets the full
 * target and the row looks like a row of chips.
 *
 * "All" is `null`, not a sixth media type: the query omits its `.eq()` entirely
 * when null, and modelling it as a string would mean a fake enum member the
 * database rejects or a magic value every call site has to strip.
 *
 * Counts ride along because "Comics & Manga" with nothing behind it is a tap
 * that costs her a screen. A category showing 0 is information; one that looks
 * identical to a full category and then empties the list is not.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · aTypes, markup 963–967 · 2026-09-03
 */
export function MediaTypeChips({ value, onChange, counts, testID = 'archive-type-chips' }: Props) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    row: { gap: 8, paddingHorizontal: 16, alignItems: 'center' },
  // A horizontal ScrollView has NO intrinsic height on react-native-web, so a
  // flex sibling below it — a results list, a rail — squeezes it to nothing.
  // The Archive's type row rendered at SIX PIXELS this way: chips present,
  // every unit test green, a sliver on screen. flexGrow/flexShrink 0 makes the
  // row keep the height its content asks for.
  scroller: { flexGrow: 0, flexShrink: 0 },
    // The touch target: full height, no paint of its own.
    target: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: PILL_HEIGHT,
      paddingHorizontal: 12,
      borderRadius: RADII.pill,
      backgroundColor: colors.raised,
    },
    // v2 › Selection: a full flat fill in pinkContainer with the emphasized
    // label. No outline, no full action pink on a chip.
    pillOn: { backgroundColor: colors.pinkContainer },
    label: { ...TYPE.label, color: colors.ink2 },
    labelOn: { ...emphasized('label'), color: colors.onPinkContainer },
    // The count sits beside the label in the same ink, regular weight — a fact
    // about the category, not the name of it.
    count: { ...TYPE.label, ...TABULAR, fontFamily: TYPE.body.fontFamily, color: colors.ink2 },
    countOn: { color: colors.onPinkContainer },
    empty: { opacity: 0.45 },
  });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.scroller}
      contentContainerStyle={s.row}
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel="Browse the Archive by type"
    >
      {ARCHIVE_TYPE_FILTERS.map((filter) => {
        const selected = value === filter.value;
        const label = archiveTypeLabel(filter.value);
        const n = counts ? filterCount(filter.value, counts) : null;
        const isEmpty = n === 0;

        return (
          <PressableScale key={filter.key} onPress={() => onChange(filter.value)} accessible={false}>
            {/* a11y identity and the testID live on this View, not the
                Pressable: RN's Pressable drops unknown props so `aria-*` never
                reaches the node, and accessibilityState alone renders nothing
                on react-native-web 0.19. */}
            <View
              style={[s.target, isEmpty && !selected && s.empty]}
              testID={`${testID}-${filter.key}`}
              accessibilityRole="radio"
              accessibilityLabel={
                n === null ? label : `${label}, ${n} ${n === 1 ? 'entry' : 'entries'}`
              }
              {...a11yState({ checked: selected })}
            >
              <View style={[s.pill, selected && s.pillOn]} testID={`${testID}-${filter.key}-pill`}>
                {/* v2: no emoji or glyph in chrome — the word and the count. */}
                <Text style={[s.label, selected && s.labelOn]}>{label}</Text>
                {n !== null ? (
                  <Text style={[s.count, selected && s.countOn]}>{n}</Text>
                ) : null}
              </View>
            </View>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
