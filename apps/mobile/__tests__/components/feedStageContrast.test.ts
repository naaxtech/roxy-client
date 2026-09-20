/**
 * The feed stage is dark in both themes. Its ink has to be too.
 *
 * This file exists because of a bug that was visible on the running app: the
 * pager forces `THEMES.dark.background` so a portrait video is not letterboxed
 * against a pale surface, but every child calling `useThemeColors()` still got
 * the *active* theme's ink. In light mode that painted `textMuted` (#735D97) on
 * `#14082A` — 3.4:1 — on the feed's own empty state, and nothing failed.
 *
 * `components/feed/stageColors.ts` is the fix: one module that says the stage is
 * a cinema. This is the gate that keeps it honest. If a new stage surface reads
 * `useThemeColors()` instead, its pairing will not appear here and the bug comes
 * back — so add every new stage ink to STAGE_INK below when you add it.
 *
 * src: https://www.w3.org/TR/WCAG22/#contrast-minimum · SC 1.4.3 · read 2026-08-16
 */
import { THEMES, contrastRatio, type ThemeColors } from '../../lib/theme';
import { STAGE, STAGE_BG } from '../../components/feed/stageColors';

const AA_TEXT = 4.5;

/** Every token painted as text on the stage ground. */
const STAGE_INK: (keyof ThemeColors)[] = [
  'textPrimary',
  'textSecondary',
  'textMuted',
  'primaryInk',
  'goldInk',
  'successInk',
];

function expectContrast(fg: string, bg: string, min: number): void {
  const measured = contrastRatio(fg, bg).toFixed(2);
  const verdict = contrastRatio(fg, bg) >= min ? 'pass' : `FAIL at ${measured}:1, needs ${min}:1`;
  expect(`${fg} on ${bg} — ${verdict}`).toBe(`${fg} on ${bg} — pass`);
}

describe('the feed stage', () => {
  it('is the dark theme, whichever theme the viewer chose', () => {
    expect(STAGE).toBe(THEMES.dark);
    expect(STAGE_BG).toBe(THEMES.dark.background);
  });

  it.each(STAGE_INK)('paints %s at AA on the stage ground', (ink) => {
    expectContrast(STAGE[ink], STAGE_BG, AA_TEXT);
  });

  /**
   * The regression itself, stated as arithmetic rather than as a memory: the
   * light theme's ink is NOT usable here, so a component that reaches for
   * `useThemeColors()` on this surface is wrong by construction.
   */
  it('proves the light theme ink would fail here — this is why stageColors exists', () => {
    expect(contrastRatio(THEMES.light.textMuted, STAGE_BG)).toBeLessThan(AA_TEXT);
    expect(contrastRatio(THEMES.light.textSecondary, STAGE_BG)).toBeLessThan(AA_TEXT);
  });
});
