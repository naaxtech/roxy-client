import React from 'react';
import { Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { COMMENT_COUNTER_FROM, COMMENT_MAX } from '../../lib/comments';

/**
 * "812 / 1000" under a comment box, only once she is near the cap.
 *
 * The input's `maxLength` stops typing at the database limit; this tells her
 * why the keyboard stopped, instead of leaving it to feel broken. Rendered
 * nothing below `COMMENT_COUNTER_FROM` so a normal comment carries no noise.
 */
export function CommentCounter({
  length, max = COMMENT_MAX, from = COMMENT_COUNTER_FROM, style, testID = 'comment-counter',
}: {
  length: number;
  max?: number;
  from?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const colors = useThemeColors();
  if (length < from) return null;
  const atCap = length >= max;
  return (
    <Text
      testID={testID}
      accessibilityLiveRegion="polite"
      accessibilityLabel={atCap ? `Limit reached, ${max} characters` : `${max - length} characters left`}
      style={[
        { fontSize: 12, textAlign: 'right', color: atCap ? colors.error : colors.textMuted, marginTop: 4 },
        style,
      ]}
    >
      {length} / {max}
    </Text>
  );
}
