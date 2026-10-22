import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { RADII, SPACE } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { RoxyO } from './RoxyO';

/** Her O beside her bubbles, dp. */
export const BUBBLE_O = 32;
/** The tail corner of a chat bubble (radius 20, 6 on the tail). */
const TAIL = 6;
/** One sentence of her reply arrives every this many ms. */
export const SENTENCE_MS = 450;

/**
 * Where each sentence of `text` ends (exclusive indices, last = length).
 * Sentences end at . ! ? … plus any closing quotes/brackets. Reveals use
 * slices of the original string, so spacing and punctuation stay hers.
 */
export function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  const re = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (end < text.length) ends.push(end);
  }
  ends.push(text.length);
  return ends;
}

/**
 * Roxy AI's reply, arriving by sentence (design direction v2 › Roxy AI chat:
 * "replies arrive by sentence"). Only a reply that arrived while the chat is
 * open (`fresh`) reveals; older ones and Reduce Motion show whole. Text being
 * read never moves: sentences are appended, nothing bounces.
 */
function SentenceReveal({ text, fresh, style }: { text: string; fresh: boolean; style: object }) {
  const reducedMotion = useReducedMotion();
  const animate = fresh && !reducedMotion;
  const ends = sentenceEnds(text);
  const [shown, setShown] = useState(animate ? 1 : ends.length);

  useEffect(() => {
    if (!animate || shown >= ends.length) return undefined;
    const t = setTimeout(() => setShown((n) => n + 1), SENTENCE_MS);
    return () => clearTimeout(t);
  }, [animate, shown, ends.length]);

  const end = ends[Math.min(shown, ends.length) - 1] ?? text.length;
  return <Text style={style}>{text.slice(0, end).trimEnd()}</Text>;
}

export type RoxyBubbleProps = {
  role: 'user' | 'roxy';
  content: string;
  index: number;
  /** A reply that arrived while she watched: it arrives by sentence. */
  fresh?: boolean;
};

/**
 * One chat bubble. Hers (the member's) on `pinkContainer` with
 * `onPinkContainer` ink, tail at the bottom end. Roxy AI's on `surface`,
 * tail at the bottom start, with her 32 dp O beside it. Radius 20, 6 on the
 * tail corner. No shadows: tone does the separation.
 */
export function RoxyBubble({ role, content, index, fresh = false }: RoxyBubbleProps) {
  const colors = useThemeColors();
  if (role === 'user') {
    return (
      <View style={[s.row, s.rowUser]}>
        <View
          testID={`roxy-bubble-user-${index}`}
          style={[s.bubble, s.bubbleUser, { backgroundColor: colors.pinkContainer }]}
        >
          <Text style={[s.text, { color: colors.onPinkContainer }]}>{content}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={s.row}>
      <RoxyO size={BUBBLE_O} testID={`roxy-bubble-o-${index}`} />
      <View
        testID={`roxy-bubble-roxy-${index}`}
        style={[s.bubble, s.bubbleRoxy, { backgroundColor: colors.surface }]}
      >
        <SentenceReveal text={content} fresh={fresh} style={[s.text, { color: colors.ink }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACE[1] },
  rowUser: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '78%',
    borderRadius: RADII.md,
    paddingHorizontal: SPACE[3],
    paddingVertical: SPACE[2],
  },
  bubbleUser: { borderBottomEndRadius: TAIL },
  bubbleRoxy: { borderBottomStartRadius: TAIL },
  text: { ...TYPE.body },
});
