import type { ReactNode } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';

interface Props {
  myStars: number | null;
  onRate: (stars: number) => void;
  comment?: string;
  onCommentChange?: (text: string) => void;
  onSubmitComment?: () => void;
  canComment?: boolean;
  commentBusy?: boolean;
  /** The pending-member line, or the "your score is public as a number" line. */
  note?: string;
  /** Watchlist / write-a-review, which the entry screen owns. */
  footer?: ReactNode;
  testID?: string;
}

const QUESTION = 'Seen it? Rate it out of 5.';
const STARS = [1, 2, 3, 4, 5] as const;

/**
 * 5-star rating plus an optional named review.
 *
 * A tap on a star is the score. The comment is a second loop — only for
 * approved members, and only if she wants to write one. Colour alone does
 * not mark her rating: each filled star is also `aria-selected`.
 */
export function VoteCard({
  myStars, onRate, comment, onCommentChange, onSubmitComment,
  canComment, commentBusy, note, footer, testID,
}: Props) {
  const colors = useThemeColors();
  const filled = myStars ?? 0;

  const s = StyleSheet.create({
    card: {
      gap: 10,
      padding: 14,
      borderRadius: RADII.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: filled ? colors.primary : colors.line,
    },
    question: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
    stars: { flexDirection: 'row', justifyContent: 'space-between' },
    star: {
      minWidth: MIN_TOUCH_TARGET,
      minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    comment: {
      minHeight: 88,
      padding: 10,
      borderRadius: RADII.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.surfaceLight,
      color: colors.textPrimary,
      ...TYPE.body,
      textAlignVertical: 'top',
    },
    submit: {
      minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: RADII.pill,
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
    },
    submitText: { ...TYPE.caption, color: '#fff', fontWeight: '800' },
    note: { ...TYPE.micro, color: colors.textMuted },
  });

  return (
    <View style={s.card} testID={testID}>
      <Text style={s.question}>{QUESTION}</Text>
      <View style={s.stars}>
        {STARS.map((n) => {
          const selected = n <= filled;
          const id = testID ? `${testID}-star-${n}` : undefined;
          return (
            <Pressable key={n} style={{ flex: 1 }} onPress={() => onRate(n)} accessible={false}>
              <View
                testID={id}
                style={s.star}
                accessibilityRole="button"
                accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
                {...a11yState({ selected })}
              >
                <Ionicons
                  name={selected ? 'star' : 'star-outline'}
                  size={28}
                  color={selected ? colors.primary : colors.textMuted}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
      {canComment ? (
        <>
          <TextInput
            testID={testID ? `${testID}-comment` : undefined}
            style={s.comment}
            value={comment}
            onChangeText={onCommentChange}
            placeholder="A short review — no spoilers about the ending."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={4000}
            accessibilityLabel="Review comment"
          />
          <Pressable
            testID={testID ? `${testID}-review-submit` : undefined}
            style={s.submit}
            onPress={onSubmitComment}
            disabled={commentBusy || !(comment ?? '').trim()}
            accessibilityRole="button"
            accessibilityLabel="Post review"
          >
            <Text style={s.submitText}>{commentBusy ? 'Posting…' : 'Post review'}</Text>
          </Pressable>
        </>
      ) : null}
      {note ? (
        <Text style={s.note} testID={testID ? `${testID}-note` : undefined}>{note}</Text>
      ) : null}
      {footer}
    </View>
  );
}
