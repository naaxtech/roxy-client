import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import type { ArchiveScore } from '../../lib/archive';

interface Props {
  score: ArchiveScore;
  /** Omitted when the caller has not counted them; the line simply gets shorter. */
  reviewCount?: number;
}

/** The one-line statement of what the Archive is, under every score. */
const PRODUCT_LINE = 'One score, one question. No critics, no stars.';

/**
 * The sentence under the ring.
 *
 * It renders nothing below the gate, and that is the whole reason it is a
 * component rather than a string in the screen. "Most of us said skip it" over
 * three votes is the gate defeated by the sentence underneath it — the number
 * is correctly withheld and the verdict says it anyway, which is worse than
 * showing the number, because it makes a claim with no sample size attached.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · behaviour 1998 · 2026-09-01
 */
export function VerdictLine({ score, reviewCount }: Props) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    wrap: { gap: 3 },
    verdict: { ...TYPE.title, color: colors.textPrimary },
    meta: { ...TYPE.caption, color: colors.textSecondary },
    product: { ...TYPE.micro, color: colors.textMuted },
  });

  if (!score.verdict) return null;

  const voted = `${score.total} members voted`;
  const meta =
    typeof reviewCount === 'number' ? `${voted} · ${reviewCount} wrote reviews` : voted;

  return (
    <View style={s.wrap}>
      <Text style={s.verdict}>{score.verdict}</Text>
      <Text style={s.meta}>{meta}</Text>
      <Text style={s.product}>{PRODUCT_LINE}</Text>
    </View>
  );
}
