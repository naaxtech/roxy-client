import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import { notePalette } from './archiveTokens';

/**
 * How many members have to agree before a note is shown on a card.
 *
 * A content note is a warning one stranger writes for another, so a single tag
 * from a single person is not yet community knowledge — it is one opinion with
 * the authority of a system label. Three is the product rule.
 */
export const NOTE_AGREEMENT_GATE = 3;

export type ArchiveNote = {
  id: string;
  label: string;
  agreeCount: number;
  agreed: boolean;
};

/**
 * The notes a card may show, most-agreed first.
 *
 * The gate counts MEMBERS, not whether the tag happens to be highlighted on her
 * device. `agreeCount` already includes her own agreement, so a note she alone
 * has agreed with sits at 1 and stays hidden — her tapping it must not be what
 * carries it over the line, or every note would be visible to the person who
 * created it and to nobody else.
 */
export function visibleNotes(notes: ArchiveNote[], limit?: number): ArchiveNote[] {
  const shown = notes
    .filter((n) => n.agreeCount >= NOTE_AGREEMENT_GATE)
    .sort((a, b) => b.agreeCount - a.agreeCount);
  return typeof limit === 'number' ? shown.slice(0, limit) : shown;
}

interface Props {
  label: string;
  agreeCount: number;
  agreed: boolean;
  /** Position in the row, which picks the palette slot. */
  index: number;
  onPress: () => void;
  testID?: string;
}

/**
 * One community content note.
 *
 * It is a **checkbox**, not a button: tapping it records that she agrees the
 * note applies, and that state has to be readable. `a11yState` emits `aria-*`
 * alongside `accessibilityState` because the bare state object renders no
 * attribute at all on react-native-web 0.19 — on the web build a screen reader
 * would hear a checkbox with no checked state, which is worse than a plain
 * button.
 *
 * Agreement beats position for colour: an agreed note is pink whatever slot the
 * rotation put it in. The rotation is decoration, the agreement is state, and a
 * colour that means something must not change with how many notes sit above it.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · behaviour 2019–2023 · 2026-09-01
 */
export function ContentNoteChip({ label, agreeCount, agreed, index, onPress, testID }: Props) {
  const colors = useThemeColors();
  const palette = notePalette(colors, index, agreed);

  const s = StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: RADII.pill,
      borderWidth: 1,
      backgroundColor: palette.bg,
      borderColor: palette.line,
    },
    label: { ...TYPE.caption, color: palette.ink, fontWeight: '700' },
    count: { ...TYPE.micro, color: palette.ink, fontWeight: '800' },
  });

  return (
    <Pressable onPress={onPress} accessible={false}>
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
        style={s.chip}
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityLabel={`${label}, ${agreeCount} members agree`}
        {...a11yState({ checked: agreed })}
      >
        <Text style={s.label}>{label}</Text>
        <Text style={s.count}>{agreeCount}</Text>
      </View>
    </Pressable>
  );
}
