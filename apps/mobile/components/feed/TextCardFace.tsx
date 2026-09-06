import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FONTS } from '../../lib/typography';
import {
  parseTextCard,
  textCardScale,
  TEXT_CARD_EXAMPLE_BODY,
  TEXT_CARD_GRADIENT,
  TEXT_CARD_INK,
  TEXT_CARD_MAX_MEASURE,
} from '../../lib/textCard';

export type TextCardSize = 'page' | 'preview' | 'tile';

type Props = {
  content: string;
  size?: TextCardSize;
  /** Empty composer: paint the prototype example at low opacity. */
  ghost?: boolean;
  testIDPrefix?: string;
  maxWidth?: number;
};

/**
 * The inner composition Claude Design paints on a text post
 * (`Roxy App.dc.html` 97–103): kick, prompt, sub, flower, plum ramp.
 */
export function TextCardFace({
  content,
  size = 'page',
  ghost = false,
  testIDPrefix = 'text-card',
  maxWidth,
}: Props): ReactElement {
  const body = content.trim();
  const parsed = parseTextCard(ghost && !body ? TEXT_CARD_EXAMPLE_BODY : body);
  const compact = size === 'tile';
  const pageStyle = textCardScale(parsed.prompt.length || 12);
  const promptStyle = compact
    ? s.tilePrompt
    : size === 'preview'
      ? [pageStyle, s.previewPrompt]
      : pageStyle;
  const measure = maxWidth != null
    ? { maxWidth: Math.min(maxWidth, TEXT_CARD_MAX_MEASURE) }
    : undefined;

  return (
    <LinearGradient
      testID={`${testIDPrefix}-gradient`}
      colors={[...TEXT_CARD_GRADIENT]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[
        s.root,
        size === 'preview' && s.preview,
        compact && s.tile,
        ghost && s.ghost,
      ]}
    >
      {parsed.kick && !compact ? (
        <View style={s.kick} testID={`${testIDPrefix}-kick`}>
          <Text style={s.kickText}>{parsed.kick}</Text>
        </View>
      ) : null}

      {parsed.prompt ? (
        <Text
          testID={`${testIDPrefix}-prompt`}
          style={[s.prompt, promptStyle, measure]}
          numberOfLines={compact ? 4 : size === 'preview' ? 6 : 8}
        >
          {parsed.prompt}
        </Text>
      ) : null}

      {parsed.sub && !compact ? (
        <Text testID={`${testIDPrefix}-sub`} style={s.sub} numberOfLines={size === 'preview' ? 3 : 6}>
          {parsed.sub}
        </Text>
      ) : null}

      {!compact ? (
        <Text
          testID={`${testIDPrefix}-flower`}
          style={[s.flower, size === 'preview' && s.previewFlower]}
          importantForAccessibility="no"
        >
          ✿
        </Text>
      ) : null}
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingTop: 34,
    paddingBottom: 34,
    gap: 18,
  },
  preview: {
    flex: 0,
    minHeight: 280,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 24,
    gap: 10,
  },
  previewPrompt: { fontSize: 26, lineHeight: 31 },
  tile: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 0,
    justifyContent: 'flex-end',
  },
  ghost: { opacity: 0.78 },
  kick: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,249,251,0.4)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  kickText: {
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.9,
    color: 'rgba(255,249,251,0.85)',
    fontFamily: FONTS.text.bold,
  },
  prompt: {
    color: TEXT_CARD_INK,
    textAlign: 'left',
  },
  tilePrompt: {
    color: TEXT_CARD_INK,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    fontFamily: FONTS.display.extrabold,
  },
  sub: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: 'rgba(255,249,251,0.75)',
    fontFamily: FONTS.text.medium,
  },
  flower: {
    fontSize: 52,
    lineHeight: 52,
    color: 'rgba(255,249,251,0.16)',
  },
  previewFlower: { fontSize: 36, lineHeight: 36 },
});
