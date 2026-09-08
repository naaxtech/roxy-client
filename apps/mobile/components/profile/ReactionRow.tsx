import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { POST_REACTIONS, reactionsOn } from '../../lib/postReactions';

interface Props {
  counts: Record<string, number> | null | undefined;
  /** Emoji she has tapped this session — the tally stores no per-viewer row. */
  mine: ReadonlySet<string>;
  onReact: (emoji: string) => void;
  /** Whether the full picker is open. */
  picking: boolean;
  onTogglePicker: () => void;
  testID?: string;
}

/**
 * Emoji reactions on a post.
 *
 * Two rows in one: the reactions a post already HAS, always visible so the
 * response to something is part of reading it; and the picker, which opens only
 * when she asks for it. Showing six empty emoji under every post would make the
 * page look like a toolbar.
 *
 * `mine` is a session memory, not a claim about the database.
 * `increment_reaction` stores a tally rather than a ballot — there is no
 * per-viewer row — so this highlights what she tapped while the screen is open
 * and does not pretend to know what she tapped last week. The same bargain
 * `components/feed/poll.ts` documents.
 */
export function ReactionRow({
  counts, mine, onReact, picking, onTogglePicker, testID = 'reactions',
}: Props) {
  const colors = useThemeColors();
  const present = reactionsOn(counts);

  const s = StyleSheet.create({
    wrap: { gap: 6 },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      minHeight: 30, paddingHorizontal: 9,
      borderRadius: RADII.pill,
      backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.line,
    },
    chipMine: { borderColor: colors.primary, backgroundColor: colors.primary + '22' },
    emoji: { fontSize: 13 },
    count: { ...TYPE.micro, color: colors.textSecondary, fontWeight: '700' },
    countMine: { color: colors.primaryInk },
    // The picker's own targets are a full 44: these are the controls she is
    // aiming at, unlike the read-only chips above.
    pick: {
      minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center', justifyContent: 'center',
      borderRadius: RADII.pill,
      backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.line,
    },
    pickEmoji: { fontSize: 19 },
    add: {
      minHeight: 30, paddingHorizontal: 10, justifyContent: 'center',
      borderRadius: RADII.pill,
      borderWidth: 1, borderColor: colors.line,
      borderStyle: 'dashed',
    },
    addText: { ...TYPE.micro, color: colors.textMuted, fontWeight: '700' },
  });

  return (
    <View style={s.wrap} testID={testID}>
      <View style={s.row}>
        {present.map(({ emoji, count }) => {
          const isMine = mine.has(emoji);
          return (
            <TouchableOpacity
              key={emoji}
              style={[s.chip, isMine && s.chipMine]}
              onPress={() => onReact(emoji)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${emoji}, ${count}. React.`}
              accessibilityState={{ selected: isMine }}
              aria-pressed={isMine}
              testID={`${testID}-chip-${emoji}`}
            >
              <Text style={s.emoji}>{emoji}</Text>
              <Text style={[s.count, isMine && s.countMine]}>{count}</Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={s.add}
          onPress={onTogglePicker}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={picking ? 'Close reactions' : 'Add a reaction'}
          accessibilityState={{ expanded: picking }}
          aria-expanded={picking}
          testID={`${testID}-add`}
        >
          <Text style={s.addText}>{picking ? 'Close' : '☺ React'}</Text>
        </TouchableOpacity>
      </View>

      {picking ? (
        <View style={s.row} testID={`${testID}-picker`}>
          {POST_REACTIONS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={s.pick}
              onPress={() => onReact(emoji)}
              accessibilityRole="button"
              accessibilityLabel={`React with ${emoji}`}
              testID={`${testID}-pick-${emoji}`}
            >
              <Text style={s.pickEmoji}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}
