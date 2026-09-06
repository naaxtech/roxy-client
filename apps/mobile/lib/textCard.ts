import type { TextStyle } from 'react-native';

/**
 * Claude Design text card (`Roxy App.dc.html` p3): the words ARE the post.
 * Scale steps with length so a short line fills the page and an essay still
 * fits. Tracking tightens as size grows; leading loosens as size drops.
 */
export const TEXT_CARD_SCALE: { max: number; style: TextStyle }[] = [
  { max: 40, style: { fontSize: 40, lineHeight: 46, fontWeight: '800', letterSpacing: -1 } },
  { max: 120, style: { fontSize: 31, lineHeight: 38, fontWeight: '800', letterSpacing: -0.6 } },
  { max: 280, style: { fontSize: 25, lineHeight: 33, fontWeight: '700', letterSpacing: -0.3 } },
  { max: Infinity, style: { fontSize: 18, lineHeight: 26, fontWeight: '600', letterSpacing: -0.1 } },
];

export const TEXT_CARD_READ_MORE = 420;
export const TEXT_CARD_MAX_LINES = 14;
export const TEXT_CARD_MAX_MEASURE = 460;

export function textCardScale(length: number): TextStyle {
  return (TEXT_CARD_SCALE.find((step) => length <= step.max) ?? TEXT_CARD_SCALE[TEXT_CARD_SCALE.length - 1]).style;
}
