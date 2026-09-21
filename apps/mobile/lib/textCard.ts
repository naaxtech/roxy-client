import type { TextStyle } from 'react-native';
import { FONTS } from './typography';

/**
 * Claude Design text card (`Roxy App.dc.html` 97–103, p3).
 *
 * The words are a composition, not a caption: kick pill, Outfit headline,
 * quieter subtitle, flower, on the plum ramp — not the brand orange.
 */
export const TEXT_CARD_GRADIENT = ['#2A1B6E', '#6D28A8', '#B02478'] as const;
export const TEXT_CARD_INK = '#FFF8FB';

/**
 * The ghost card shown before she has typed anything.
 *
 * It used to be the design mockup's own filler — "PROMPT OF THE DAY / What's
 * your favourite queer-owned spot in London? / Best answer gets pinned to the
 * community board". Three things wrong with shipping that as the composer's
 * empty state: it reads as a prompt she has been set rather than a preview of
 * her own card, it names a city she may have no connection to, and it promises
 * a community board the 3.0 model retired — posts live on her profile now (see
 * lib/postComposer.ts). A preview demonstrates the shape; it must not make a
 * promise the app cannot keep.
 */
export const TEXT_CARD_EXAMPLE = {
  kick: 'TEXT CARD',
  prompt: 'Say the thing.',
  sub: 'A second, quieter line — optional ✿',
} as const;

export const TEXT_CARD_EXAMPLE_BODY = [
  TEXT_CARD_EXAMPLE.kick,
  TEXT_CARD_EXAMPLE.prompt,
  TEXT_CARD_EXAMPLE.sub,
].join('\n');

/**
 * The input's own placeholder. Deliberately an instruction, not example
 * content: the ghost card above the field already shows the shape, and
 * repeating the example inside the field is what made it read as a question
 * she had been asked rather than a card she was writing.
 */
export const TEXT_CARD_PLACEHOLDER = [
  'Your first line — the one that carries it',
  'A quieter second line, if you want one',
].join('\n');

export type TextCardParts = {
  kick: string | null;
  prompt: string;
  sub: string | null;
};

/** A short all-caps label — "PROMPT OF THE DAY" — not a sentence. */
function isKick(line: string): boolean {
  if (line.length > 36 || /[?!]/.test(line)) return false;
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length >= 0.85;
}

export function parseTextCard(content: string): TextCardParts {
  const lines = content.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { kick: null, prompt: '', sub: null };

  let rest = lines;
  let kick: string | null = null;
  if (lines.length >= 2 && isKick(lines[0])) {
    kick = lines[0];
    rest = lines.slice(1);
  }

  return {
    kick,
    prompt: rest[0] ?? '',
    sub: rest.length > 1 ? rest.slice(1).join('\n') : null,
  };
}

/**
 * Scale the *prompt* only. The design's 34 / 1.14 / −0.01em is the short
 * step; longer headlines step down so they still fit the page.
 */
export const TEXT_CARD_SCALE: { max: number; style: TextStyle }[] = [
  {
    max: 80,
    style: {
      fontSize: 34, lineHeight: 39, fontWeight: '800', letterSpacing: -0.34,
      fontFamily: FONTS.display.extrabold,
    },
  },
  {
    max: 160,
    style: {
      fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.2,
      fontFamily: FONTS.display.extrabold,
    },
  },
  {
    max: 280,
    style: {
      fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.15,
      fontFamily: FONTS.display.bold,
    },
  },
  {
    max: Infinity,
    style: {
      fontSize: 18, lineHeight: 24, fontWeight: '700', letterSpacing: -0.1,
      fontFamily: FONTS.display.bold,
    },
  },
];

export const TEXT_CARD_READ_MORE = 420;
export const TEXT_CARD_MAX_LINES = 8;
export const TEXT_CARD_MAX_MEASURE = 460;

export function textCardScale(length: number): TextStyle {
  return (TEXT_CARD_SCALE.find((step) => length <= step.max) ?? TEXT_CARD_SCALE[TEXT_CARD_SCALE.length - 1]).style;
}
