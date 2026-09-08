import { parseCoverGradient, coverGradientFor } from '../../lib/coverGradient';

/**
 * `archive_entries.cover_gradient` holds the DESIGN's own CSS, verbatim —
 * `linear-gradient(160deg,#1E2A4E,#4A3A7A 55%,#D98A5E)`. Migration 098 seeded
 * one per entry, straight from the prototype, and they are the closest thing
 * the Archive has to cover art.
 *
 * React Native cannot read a CSS gradient string. Without a parser those values
 * sit in the database doing nothing, which is why the entry page rendered flat
 * while the design's is dominated by colour.
 */

describe('parseCoverGradient', () => {
  it('reads the design’s three-stop form', () => {
    expect(parseCoverGradient('linear-gradient(160deg,#1E2A4E,#4A3A7A 55%,#D98A5E)'))
      .toEqual(['#1E2A4E', '#4A3A7A', '#D98A5E']);
  });

  it('keeps stop order, because a gradient reversed is a different picture', () => {
    expect(parseCoverGradient('linear-gradient(160deg,#AAAAAA,#BBBBBB 55%,#CCCCCC)'))
      .toEqual(['#AAAAAA', '#BBBBBB', '#CCCCCC']);
  });

  it('handles two stops and whitespace', () => {
    expect(parseCoverGradient('linear-gradient(120deg, #FF5A2E , #E0189A )'))
      .toEqual(['#FF5A2E', '#E0189A']);
  });

  it('accepts 3-digit hex', () => {
    expect(parseCoverGradient('linear-gradient(90deg,#abc,#def)')).toEqual(['#abc', '#def']);
  });

  it('returns null rather than a half-parsed gradient', () => {
    // One usable colour is not a gradient, and rendering it as one would paint
    // a flat block where the design has a picture.
    expect(parseCoverGradient('linear-gradient(90deg,#1E2A4E)')).toBeNull();
    expect(parseCoverGradient('radial-gradient(#fff,#000)')).toBeNull();
    expect(parseCoverGradient('not a gradient')).toBeNull();
    expect(parseCoverGradient(null)).toBeNull();
    expect(parseCoverGradient('')).toBeNull();
  });
});

describe('coverGradientFor', () => {
  it('prefers the stored gradient when there is one', () => {
    expect(coverGradientFor('linear-gradient(160deg,#111111,#222222,#333333)', 'carol'))
      .toEqual(['#111111', '#222222', '#333333']);
  });

  it('falls back to a deterministic gradient from the slug', () => {
    // An entry a member submitted has no gradient until a mod adds one. It gets
    // art anyway, and the SAME art every time — a cover that changed between
    // renders would read as a loading glitch.
    const a = coverGradientFor(null, 'gentleman-jack');
    const b = coverGradientFor(null, 'gentleman-jack');
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(2);
  });

  it('gives different entries different art', () => {
    expect(coverGradientFor(null, 'carol')).not.toEqual(coverGradientFor(null, 'bound'));
  });

  it('falls back when the stored value is unparseable rather than rendering nothing', () => {
    const out = coverGradientFor('rubbish', 'carol');
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
});
