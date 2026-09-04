import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';

/** The painted pill's height. The TARGET is MIN_TOUCH_TARGET; this is the ink. */
const PILL_HEIGHT = 34;

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
      style={s.scroller}
      contentContainerStyle={s.row}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
    >
      {chips.map((chip) => {
        const on = chip.key === value;
        const fill = primary ? colors.primary : colors.surfaceLight;
        return (
          <Pressable key={chip.key} onPress={() => onChange(chip.key)} accessible={false}>
            {/* The 44pt minimum belongs on what a FINGER HITS. Putting it on the
                painted pill made every chip a 44pt slab carrying a 12px word,
                and two stacked rows of those pushed the rails off the screen.
                The target below is full height and transparent; the pill inside
                is 34pt and is only paint.

                The a11y identity sits on this View rather than the Pressable:
                RN's Pressable drops unknown props so `aria-*` never reaches the
                node, and accessibilityState alone is inert on
                react-native-web 0.19. */}
            <View
              style={s.target}
              testID={testID ? `${testID}-${chip.key}` : undefined}
              accessibilityRole="radio"
              {...a11yState({ selected: on, checked: on })}
              accessibilityLabel={chip.label}
            >
              <View
                testID={testID ? `${testID}-${chip.key}-pill` : undefined}
                style={[
                  s.chip,
                  on
                    ? { backgroundColor: fill, borderColor: fill }
                    : { backgroundColor: colors.surface, borderColor: colors.line },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    primary ? s.labelPrimary : s.labelInline,
                    { color: on ? inkOn(fill) : colors.textSecondary },
                  ]}
                >
                  {chip.label}
                </Text>
              </View>
            </View>
          </Pressable>
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
  // A horizontal ScrollView has NO intrinsic height on react-native-web, so a
  // flex sibling below it — a results list, a rail — squeezes it to nothing.
  // The Archive's type row rendered at SIX PIXELS this way: chips present,
  // every unit test green, a sliver on screen. flexGrow/flexShrink 0 makes the
  // row keep the height its content asks for.
  scroller: { flexGrow: 0, flexShrink: 0 },
  // The touch target: full height, no paint of its own.
  target: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    height: PILL_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  // Primary leads by WEIGHT, not by size. It was bodyLg — 15px against the
  // in-rail 12px — which made the top row read as a different kind of object
  // rather than as the more important one.
  labelPrimary: { ...TYPE.caption, fontWeight: '800' },
  labelInline: { ...TYPE.caption, fontWeight: '600' },
  tail: { width: 4 },
});
