/**
 * QuestionOfTheDayCard's "+ Add yours" CTA is a label on a three-stop gradient,
 * and this file is the gate on its ink.
 *
 * Two wrong answers preceded the current one. The card first hardcoded a
 * one-off ramp with a hardcoded `#fff`: 3.56:1, a plain SC 1.4.3 failure. The
 * fix moved it to `BRAND_GRADIENT` with `inkOn(BRAND_GRADIENT[1])` — and this
 * file, in its previous form, measured that ink against that same middle stop
 * and called it a pass at 4.74:1. It was green while the ink measured 4.23:1
 * against `#E0189A` at the end of the ramp, which is where the trailing glyphs
 * of a centred label sit.
 *
 * So the rule this file now enforces: a label on a gradient is measured against
 * EVERY stop, and the ink comes from `inkOnGradient`, which reasons about the
 * worst one.
 *
 * src: https://www.w3.org/TR/WCAG22/#contrast-minimum · SC 1.4.3 · read 2026-08-19
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { BRAND_GRADIENT, THEMES, contrastRatio, inkOn, inkOnGradient, pinkFill } from '../../../lib/theme';
import { QuestionOfTheDayCard } from '../../../components/grow/QuestionOfTheDayCard';

const AA_TEXT = 4.5;

const mockQuestion = {
  id: 'q1',
  question: 'What made you smile today?',
  answer_count: 0,
};

// v2: the real light theme (the default). The mock used to be the v0 violet
// palette from lib/constants, which has none of the v2 roles (pink, onPink).
jest.mock('../../../hooks/useThemeColors', () => ({
  useThemeColors: () => jest.requireActual('../../../lib/theme').THEMES.light,
}));

jest.mock('../../../components/grow/AnswerSheet', () => ({
  AnswerSheet: () => null,
}));

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

type Row = typeof mockQuestion | null;
type Chain = Record<string, jest.Mock>;

const makeChain = (returnValue: Row) => {
  const chain: Chain = {};
  const methods = ['select', 'in', 'eq', 'is', 'order', 'limit', 'maybeSingle'];
  methods.forEach((m) => {
    chain[m] = jest.fn(() => {
      if (m === 'maybeSingle') return Promise.resolve({ data: returnValue, error: null });
      return chain;
    });
  });
  return chain;
};

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'questions_of_the_day') return makeChain(mockQuestion);
      return makeChain(null);
    }),
  },
}));

/** The ink the card actually paints — imported shape, not a copy of it. */
const CTA_INK = inkOnGradient(BRAND_GRADIENT);

describe('QuestionOfTheDayCard contrast', () => {
  // EVERY stop, not the middle one. The previous version of this test measured
  // `inkOn(BRAND_GRADIENT[1])` against `BRAND_GRADIENT[1]` — the same stop on
  // both sides — so it was green while the ink measured 4.23:1 against the end
  // of the ramp, where the trailing glyphs of a centred label sit.
  it.each(BRAND_GRADIENT.map((stop, i) => [i, stop] as const))(
    'clears AA text contrast on stop %i (%s)',
    (_i, stop) => {
      const ratio = contrastRatio(CTA_INK, stop);
      const verdict = ratio >= AA_TEXT ? 'pass' : `FAIL at ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`;
      expect(`${CTA_INK} on ${stop} — ${verdict}`).toBe(`${CTA_INK} on ${stop} — pass`);
    }
  );

  it('proves the middle-stop shortcut would have failed', () => {
    // Named so the next person does not reintroduce it: this is the exact
    // expression the card used to hold, and this is the stop it fails on.
    expect(contrastRatio(inkOn(BRAND_GRADIENT[1]), BRAND_GRADIENT[2])).toBeLessThan(AA_TEXT);
  });

  it('proves the old hardcoded #fff-on-old-gradient combination actually failed', () => {
    expect(contrastRatio('#FFFFFF', '#FF2F71')).toBeLessThan(AA_TEXT);
  });

  // v2 (2026-10-21): the brand ramp is for the wordmark only; the CTA is the
  // flat theme pink. (Was: "paints the CTA with BRAND_GRADIENT".)
  it('paints the CTA with the flat pink fill, not a ramp (v2)', async () => {
    const { getByText } = render(
      <QuestionOfTheDayCard communityIds={['c1']} userId="u1" />
    );
    await waitFor(() => {
      expect(getByText('+ Add yours')).toBeTruthy();
    });

    const label = getByText('+ Add yours');
    const gradientNode = label.parent?.parent;
    expect(gradientNode?.props.colors).toEqual(pinkFill(THEMES.light));
  });

  // v2: on the flat pink the ink is the theme's onPink, measured against that
  // one fill. (Was: "derives the CTA label ink from the whole ramp".)
  it('inks the CTA label with onPink, which clears AA on the fill (v2)', async () => {
    const { getByText } = render(
      <QuestionOfTheDayCard communityIds={['c1']} userId="u1" />
    );
    await waitFor(() => {
      expect(getByText('+ Add yours')).toBeTruthy();
    });

    const label = getByText('+ Add yours');
    const color = StyleSheet.flatten(label.props.style).color as string;
    expect(color).toBe(THEMES.light.onPink);
    expect(contrastRatio(color, THEMES.light.pink)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(color).not.toBe('#fff');
  });
});
