import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE, FONTS } from '../../lib/typography';
import { RADII, SPACE, MARGIN, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import { haptic } from '../../lib/haptics';
import { PRESS } from '../../lib/motion';
import { useThemeStore } from '../../store/themeStore';
import { PressableScale, stateLayerFor } from '../ui/PressableScale';
import { byTheme } from './byTheme';

/** The painted pill's height. The TARGET is MIN_TOUCH_TARGET; this is the ink. */
const PILL_HEIGHT = SPACE[6] + SPACE[0];
/** The end fade over the top row (direction › Discover: "scrolls with an end fade"). */
const FADE_WIDTH = SPACE[6];

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
  /** The top-level row gets the end fade; an in-rail row does not. */
  emphasis?: 'primary' | 'inline';
  testID?: string;
}

/**
 * A single-choice chip row (design direction v2 › Motion › Selection).
 *
 * Chips rest on `raised` with an `ink2` label; the selected chip is a full
 * flat `pinkContainer` fill with the emphasized label in `onPinkContainer` —
 * no glow, no outline, no hot pink. Selecting gives a selection haptic
 * (native only). Presses morph pill → 12 via the shared press primitive's
 * radius rule (the chip is a pill).
 *
 * `accessibilityRole="radio"` inside a `radiogroup`, not "button": exactly one
 * chip is always on, and a screen reader should say so.
 *
 * The top row scrolls sideways (translations run 35-40% longer) and fades at
 * its end so it reads as scrollable rather than cut off.
 */
export function FilterChips<T extends string>({
  chips, value, onChange, label, emphasis = 'inline', testID,
}: Props<T>) {
  const colors = useThemeColors();
  const s = styles(colors);
  const primary = emphasis === 'primary';
  const layer = stateLayerFor(useThemeStore((st) => st.theme));

  const select = (next: T) => {
    if (next !== value) haptic('select');
    onChange(next);
  };

  return (
    <View style={s.wrap}>
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
          return (
            // The press belongs on the PILL, not on the transparent 48 dp target
            // around it (a state layer over the target would paint a capsule
            // taller than the chip). So the target is the PressableScale with
            // its own feedback off, and the pill reads `pressed`: the shared
            // scale and a state layer clipped to the pill. C0 handover: the
            // chips were a raw Pressable with no press state at all.
            <PressableScale
              key={chip.key}
              onPress={() => select(chip.key)}
              accessible={false}
              feedback="none"
            >
              {({ pressed }) => (
                // The 48 dp minimum belongs on what a FINGER HITS. The target
                // below is full height and transparent; the pill inside is
                // paint only. The a11y identity sits on this View rather than
                // the Pressable: RN's Pressable drops unknown props so `aria-*`
                // never reaches the node on react-native-web 0.19.
                <View
                  style={s.target}
                  testID={testID ? `${testID}-${chip.key}` : undefined}
                  accessibilityRole="radio"
                  {...a11yState({ selected: on, checked: on })}
                  accessibilityLabel={chip.label}
                >
                  <View
                    testID={testID ? `${testID}-${chip.key}-pill` : undefined}
                    style={[s.chip, { backgroundColor: on ? colors.pinkContainer : colors.raised }, pressed && s.chipPressed]}
                  >
                    <Text
                      numberOfLines={1}
                      style={on ? s.labelOn : s.labelOff}
                    >
                      {chip.label}
                    </Text>
                    {pressed ? (
                      <View
                        pointerEvents="none"
                        testID={testID ? `${testID}-${chip.key}-press` : undefined}
                        style={[s.pressLayer, { backgroundColor: layer.color, opacity: layer.alpha }]}
                      />
                    ) : null}
                  </View>
                </View>
              )}
            </PressableScale>
          );
        })}
        {/* Trailing room so the last chip can scroll clear of the fade. */}
        <View style={primary ? s.tailFaded : s.tail} />
      </ScrollView>
      {primary ? (
        <LinearGradient
          pointerEvents="none"
          colors={[`${colors.ground}00`, colors.ground]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={s.fade}
          testID={testID ? `${testID}-fade` : undefined}
        />
      ) : null}
    </View>
  );
}

// Built once per theme, not on every render (jank audit #8).
const styles = byTheme((colors: ThemeColors) => StyleSheet.create({
  wrap: { flexGrow: 0, flexShrink: 0 },
  row: { gap: SPACE[1], paddingHorizontal: MARGIN, alignItems: 'center' },
  // A horizontal ScrollView has NO intrinsic height on react-native-web, so a
  // flex sibling below it squeezes it to nothing (the Archive's type row once
  // rendered at six pixels). flexGrow/flexShrink 0 keeps the content height.
  scroller: { flexGrow: 0, flexShrink: 0 },
  target: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    height: PILL_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: SPACE[3],
    borderRadius: RADII.pill,
    overflow: 'hidden',
  },
  chipPressed: { transform: [{ scale: PRESS.scale }] },
  pressLayer: { ...StyleSheet.absoluteFillObject },
  // Text tops out at 600, so the chip's emphasized pair is 500 at rest → 600 on.
  labelOn: { ...TYPE.label, color: colors.onPinkContainer },
  labelOff: { ...TYPE.label, fontFamily: FONTS.text.medium, color: colors.ink2 },
  tail: { width: SPACE[0] },
  tailFaded: { width: FADE_WIDTH },
  fade: { position: 'absolute', top: 0, bottom: 0, right: 0, width: FADE_WIDTH },
}));
