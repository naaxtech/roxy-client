import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import { SCORE_GRADIENT } from './archiveTokens';

export type MyVote = 'up' | 'down' | null;

interface Props {
  myVote: MyVote;
  onUp: () => void;
  onDown: () => void;
  /** The pending-member line, or the "your score is public as a number" line. */
  note?: string;
  /** Watchlist / write-a-review, which the entry screen owns. */
  footer?: ReactNode;
  testID?: string;
}

const QUESTION = 'Seen it? Would you recommend it to another wlw?';

/**
 * The whole scoring surface: one question, two answers.
 *
 * Her answer is marked with a **tick as well as a colour**. Both buttons are
 * coloured whatever she picks, so colour alone cannot say which one is hers —
 * WCAG 1.4.1, and in practice the difference between a green and a red button
 * is invisible to a large minority of the people this app is for.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · behaviour 2008–2018 · 2026-09-01
 */
export function VoteCard({ myVote, onUp, onDown, note, footer, testID }: Props) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    card: {
      gap: 10,
      padding: 14,
      borderRadius: RADII.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: myVote ? colors.primary : colors.line,
    },
    question: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
    answers: { flexDirection: 'row', gap: 10 },
    answer: {
      flex: 1,
      minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: RADII.pill,
      backgroundColor: colors.surfaceLight,
      borderWidth: 1,
      borderColor: colors.line,
    },
    answerText: { ...TYPE.body, color: colors.textPrimary, fontWeight: '800' },
    note: { ...TYPE.micro, color: colors.textMuted },
  });

  const answer = (
    side: 'up' | 'down',
    label: string,
    spoken: string,
    onPress: () => void
  ) => {
    const selected = myVote === side;
    const gradient = side === 'up' ? SCORE_GRADIENT.good : SCORE_GRADIENT.poor;
    const text = `${label}${selected ? ' ✓' : ''}`;
    const id = testID ? `${testID}-${side}` : undefined;

    // The a11y identity and the testID sit on the painted node, not on the
    // Pressable around it — RN's Pressable drops `aria-*`, and
    // accessibilityState alone renders nothing on react-native-web 0.19.
    const common = {
      testID: id,
      accessibilityRole: 'button' as const,
      accessibilityLabel: spoken,
      ...a11yState({ selected }),
    };

    return (
      <Pressable style={{ flex: 1 }} onPress={onPress} accessible={false}>
        {selected ? (
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.answer}
            {...common}
          >
            <Text style={[s.answerText, { color: inkOn(gradient[1]) }]}>{text}</Text>
          </LinearGradient>
        ) : (
          <View style={s.answer} {...common}>
            <Text style={s.answerText}>{text}</Text>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={s.card} testID={testID}>
      <Text style={s.question}>{QUESTION}</Text>
      <View style={s.answers}>
        {answer('up', '👍 Yes', 'Yes, I would recommend it to another wlw', onUp)}
        {answer('down', '👎 No', 'No, I would not recommend it', onDown)}
      </View>
      {note ? (
        <Text style={s.note} testID={testID ? `${testID}-note` : undefined}>{note}</Text>
      ) : null}
      {footer}
    </View>
  );
}
