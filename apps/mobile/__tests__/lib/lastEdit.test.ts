import { describeLastEdit } from '../../lib/archive';

/**
 * "Last edit: runtime, 3 days ago by @mayalin.art" — the design's own credit
 * line, and the thing that makes "member-maintained" a visible fact rather than
 * a claim on a page nobody has edited.
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('describeLastEdit', () => {
  it('names what changed, when, and who', () => {
    expect(describeLastEdit(['title', 'length_label'], daysAgo(3), 'mayalin.art'))
      .toBe('title & length_label, 3 days ago by @mayalin.art');
  });

  it('says nothing at all before an edit has been published', () => {
    // Inventing a credit is the exact opposite of what this line demonstrates.
    expect(describeLastEdit(['title'], null, 'someone')).toBeNull();
  });

  it('drops the byline rather than crediting a deleted account', () => {
    expect(describeLastEdit(['summary'], daysAgo(1), null)).toBe('summary, yesterday');
  });

  it('reads naturally at each distance', () => {
    expect(describeLastEdit(['x'], daysAgo(0), 'a')).toContain('today');
    expect(describeLastEdit(['x'], daysAgo(1), 'a')).toContain('yesterday');
    expect(describeLastEdit(['x'], daysAgo(40), 'a')).toContain('a month ago');
    expect(describeLastEdit(['x'], daysAgo(80), 'a')).toContain('2 months ago');
  });

  it('falls back to "details" when the patch names no fields', () => {
    expect(describeLastEdit([], daysAgo(2), 'a')).toBe('details, 2 days ago by @a');
  });

  it('says recently rather than NaN on an unparseable date', () => {
    expect(describeLastEdit(['x'], 'not-a-date', 'a')).toBe('x, recently by @a');
  });
});
