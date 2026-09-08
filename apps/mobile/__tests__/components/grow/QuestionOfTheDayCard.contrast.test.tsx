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
import { render, waitFor } from '@testing-library/react-native';
import { BRAND_GRADIENT, contrastRatio, inkOn, inkOnGradient } from '../../../lib/theme';
import { QuestionOfTheDayCard } from '../../../components/grow/QuestionOfTheDayCard';

const AA_TEXT = 4.5;

const mockQuestion = {
  id: 'q1',
  question: 'What made you smile today?',
  answer_count: 0,
};

jest.mock('../../../hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    primary: '#C4476A', secondary: '#8B5CF6', accent: '#F472B6',
    background: '#1a0a2e', surface: '#2d1b4e', surfaceLight: '#3d2b5e',
    textPrimary: '#FFFFFF', textSecondary: '#C4B5D4', textMuted: '#8B7AA8',
    success: '#10B981', warning: '#F59E0B', error: '#EF4444',
    roxy: '#E879A6', devPanel: '#FF1493',
  }),
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

  it('paints the CTA with BRAND_GRADIENT, not the one-off hardcoded ramp', async () => {
    const { getByText } = render(
      <QuestionOfTheDayCard communityIds={['c1']} userId="u1" />
    );
    await waitFor(() => {
      expect(getByText('+ Add yours')).toBeTruthy();
    });

    const label = getByText('+ Add yours');
    const gradientNode = label.parent?.parent;
    expect(gradientNode?.props.colors).toEqual(BRAND_GRADIENT);
  });

  it('derives the CTA label ink from the whole ramp, not one stop and not #fff', async () => {
    const { getByText } = render(
      <QuestionOfTheDayCard communityIds={['c1']} userId="u1" />
    );
    await waitFor(() => {
      expect(getByText('+ Add yours')).toBeTruthy();
    });

    const label = getByText('+ Add yours');
    const flatStyle = [label.props.style].flat();
    const color = flatStyle.find(
      (st): st is { color: string } => !!st && typeof st === 'object' && 'color' in st
    )?.color;
    expect(color).toBe(CTA_INK);
    expect(color).not.toBe('#fff');
    expect(color).not.toBe(inkOn(BRAND_GRADIENT[1]));
  });
});
