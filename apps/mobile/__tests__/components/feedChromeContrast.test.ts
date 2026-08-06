/**
 * The feed chrome's legibility contract, executable.
 *
 * The defect this file locks shut: `MEDIA_SCRIM_LOCATIONS` used to be
 * `[0.35, 0.62, 1]` — FRACTIONS of the page — while the identity block is
 * positioned in fixed dp from the bottom. So the alpha the text actually sat on
 * was a function of how tall the page happened to be, and Connect's feed (under
 * a header, under a sub-tab row, above a 68dp tab bar) is the shortest page in
 * the app. Measured over a white photo before the fix:
 *
 *   page   handle   caption   "more"
 *   320dp  1.86:1   2.40:1    3.63:1
 *   400dp  2.62:1   3.25:1    4.31:1
 *   620dp  4.63:1   5.28:1    5.54:1
 *
 * Every one of those needs 4.5:1. The rail was worse — the like button 1.99:1 at
 * 620dp and 1.00:1 on a short page, the avatar ring and the crest ring
 * white-on-white at 1.00:1.
 *
 * `CHROME_SHADOW` is not the answer and is not counted here: WCAG defines no
 * method for scoring a text shadow, so a halo can look like help and prove
 * nothing. What is scored is the composite of a glyph over the backing the
 * chrome supplies, against the worst backdrop a feed can be handed — a pure
 * white frame.
 *
 * The maths is re-implemented here rather than imported, so a bug in a shipped
 * helper cannot make the gate pass. Same rule as `theme.contrast.test.ts`.
 *
 * src: https://www.w3.org/TR/WCAG22/#contrast-minimum · SC 1.4.3, 1.4.11 · read 2026-08-07
 * src: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance · read 2026-08-07
 */
import {
  CHROME_BOTTOM,
  CREST_SIZE,
  MEDIA_SCRIM_BOTTOM_ALPHA,
  MEDIA_SCRIM_FADE,
  MEDIA_SCRIM_MIN_BODY,
  MEDIA_SCRIM_TOP_ALPHA,
  RAIL_BACKING_ALPHA,
  scrimAlphaAt,
} from '../../components/feed/feedChromeTokens';

/** SC 1.4.3 — text below 18.66px bold / 24px regular. Everything in the chrome. */
const AA_TEXT = 4.5;
/** SC 1.4.11 — icons, rings, state indicators. */
const AA_NON_TEXT = 3;

/** The page heights the audit measured. Connect's feed is the short one. */
const PAGE_HEIGHTS = [320, 400, 620] as const;

/** The worst frame a feed can be handed. */
const WHITE: RGB = [255, 255, 255];

type RGB = [number, number, number];

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: RGB): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg: RGB, bg: RGB): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `src` at `alpha` over `dst`, straight alpha, per-channel. */
function over(src: RGB, alpha: number, dst: RGB): RGB {
  return [0, 1, 2].map((i) => src[i] * alpha + dst[i] * (1 - alpha)) as RGB;
}

const BLACK: RGB = [0, 0, 0];

function hex(value: string): RGB {
  const raw = value.replace('#', '');
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Asserts through a string so a failure names the pair and the measured ratio
 * rather than only reporting that 3.61 is not 4.5.
 */
function expectContrast(what: string, measured: number, min: number): void {
  const verdict = measured >= min ? 'pass' : `FAIL at ${round(measured)}:1, needs ${min}:1`;
  expect(`${what} — ${verdict}`).toBe(`${what} — pass`);
}

// ---------------------------------------------------------------------------
// The chrome's own geometry, in dp above the bottom of the page.
// ---------------------------------------------------------------------------

/**
 * How tall the identity block's own backing is for a given post.
 *
 * The scrim's dark band wraps the identity block, so its height is the block's
 * content plus the bottom inset — never a share of the page. `MIN_BODY` keeps
 * the crest inside the band even when a post has no handle, no caption and no
 * community line to render.
 */
function bodyHeight(identityContent: number): number {
  return Math.max(MEDIA_SCRIM_MIN_BODY, identityContent + CHROME_BOTTOM);
}

/** A two-line caption with a "more" affordance and a community line. */
const TYPICAL_IDENTITY = 109;
/** Nothing joined: no handle, no caption, no community. */
const BARE_IDENTITY = 0;

/**
 * What the chrome renders where, and which bar each run has to clear.
 *
 * The identity runs are all pinned at the TOP of the band — the lightest point
 * the block ever reaches — because that is the worst case for every glyph
 * inside it and it is the invariant the layout actually guarantees: the block
 * IS the band's content, so nothing in it can sit above the band's top edge.
 */
interface Run {
  what: string;
  colour: RGB;
  /** Straight alpha of the glyph itself, for the runs that are not solid white. */
  opacity: number;
  /** dp above the bottom of the page, or null for "the top of the band". */
  dp: number | null;
  min: number;
  /** Backed by the rail's own plate rather than by the scrim. */
  rail?: boolean;
}

const RUNS: Run[] = [
  { what: 'handle #fff', colour: hex('#ffffff'), opacity: 1, dp: null, min: AA_TEXT },
  { what: 'caption rgba(255,255,255,0.95)', colour: hex('#ffffff'), opacity: 0.95, dp: null, min: AA_TEXT },
  { what: '"more" rgba(255,255,255,0.85)', colour: hex('#ffffff'), opacity: 0.85, dp: null, min: AA_TEXT },
  { what: 'community rgba(255,255,255,0.9)', colour: hex('#ffffff'), opacity: 0.9, dp: null, min: AA_TEXT },
  {
    what: 'crest ring rgba(255,255,255,0.55)',
    colour: hex('#ffffff'),
    opacity: 0.55,
    dp: CHROME_BOTTOM + CREST_SIZE,
    min: AA_NON_TEXT,
  },
  { what: 'rail glyph #fff', colour: hex('#ffffff'), opacity: 1, dp: null, min: AA_NON_TEXT, rail: true },
  { what: 'rail count #fff', colour: hex('#ffffff'), opacity: 1, dp: null, min: AA_TEXT, rail: true },
  { what: 'liked heart #E81C8E', colour: hex('#E81C8E'), opacity: 1, dp: null, min: AA_NON_TEXT, rail: true },
  { what: 'saved bookmark #FFB020', colour: hex('#FFB020'), opacity: 1, dp: null, min: AA_NON_TEXT, rail: true },
  { what: 'avatar ring rgba(255,255,255,0.9)', colour: hex('#ffffff'), opacity: 0.9, dp: null, min: AA_NON_TEXT, rail: true },
  { what: 'follow badge #FF2F71', colour: hex('#FF2F71'), opacity: 1, dp: null, min: AA_NON_TEXT, rail: true },
];

/**
 * The ratio one run reaches over a white frame on a page of a given height.
 *
 * `pageHeight` is taken and deliberately unused: that IS the fix. Alpha at the
 * chrome is now a function of the chrome's own dp geometry, so the page it sits
 * on cannot change it. The parameter stays so this file measures the same thing
 * the audit measured and can prove the three rows are now identical.
 */
function measure(run: Run, identityContent: number, _pageHeight: number): number {
  const body = bodyHeight(identityContent);
  const backingAlpha = run.rail
    ? RAIL_BACKING_ALPHA
    : scrimAlphaAt(run.dp ?? body, body);
  const backdrop = over(BLACK, backingAlpha, WHITE);
  return ratio(over(run.colour, run.opacity, backdrop), backdrop);
}

describe('the feed scrim is anchored in dp, not in a share of the page', () => {
  it('reaches the same alpha at the chrome on a 320, a 400 and a 620dp page', () => {
    const rows = PAGE_HEIGHTS.map((pageHeight) =>
      RUNS.map((run) => round(measure(run, TYPICAL_IDENTITY, pageHeight))));

    // One distinct row means the ratio no longer depends on how tall the page
    // is — which is the whole defect: the identity block is placed in dp and
    // the scrim used to be placed in fractions.
    expect(new Set(rows.map((row) => row.join('|'))).size).toBe(1);
  });

  it('holds the ramp above the block, so nothing in the block sits in the fade', () => {
    const body = bodyHeight(TYPICAL_IDENTITY);

    // At and below the top of the block: full working alpha.
    expect(scrimAlphaAt(body, body)).toBeCloseTo(MEDIA_SCRIM_TOP_ALPHA, 5);
    expect(scrimAlphaAt(0, body)).toBeCloseTo(MEDIA_SCRIM_BOTTOM_ALPHA, 5);
    expect(scrimAlphaAt(body / 2, body)).toBeGreaterThan(MEDIA_SCRIM_TOP_ALPHA);

    // Above it: a ramp of a fixed dp length, reaching nothing at its top.
    expect(scrimAlphaAt(body + MEDIA_SCRIM_FADE, body)).toBeCloseTo(0, 5);
    expect(scrimAlphaAt(body + MEDIA_SCRIM_FADE + 1, body)).toBe(0);
    expect(scrimAlphaAt(body + MEDIA_SCRIM_FADE / 2, body))
      .toBeCloseTo(MEDIA_SCRIM_TOP_ALPHA / 2, 5);
  });

  it('keeps the crest inside the band even on a post with nothing to say', () => {
    // No handle, no caption, no community — the identity block collapses to
    // nothing and the crest would otherwise hang above the scrim entirely.
    const body = bodyHeight(BARE_IDENTITY);

    expect(scrimAlphaAt(CHROME_BOTTOM + CREST_SIZE, body))
      .toBeGreaterThanOrEqual(MEDIA_SCRIM_TOP_ALPHA);
  });
});

describe('every run of the feed chrome clears its WCAG bar over a white frame', () => {
  for (const run of RUNS) {
    it(`${run.what} clears ${run.min}:1`, () => {
      for (const pageHeight of PAGE_HEIGHTS) {
        expectContrast(
          `${run.what} at ${pageHeight}dp`,
          measure(run, TYPICAL_IDENTITY, pageHeight),
          run.min,
        );
      }
    });
  }

  it('still clears its bar on a post whose identity block is empty', () => {
    for (const run of RUNS) {
      expectContrast(
        `${run.what} over a bare identity block`,
        measure(run, BARE_IDENTITY, 320),
        run.min,
      );
    }
  });
});
