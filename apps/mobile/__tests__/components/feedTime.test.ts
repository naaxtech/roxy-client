import { shortAge } from '../../components/feed/feedTime';

/**
 * The age beside the author's name (board v2-04: "Inês R. · 2 h"). Whole
 * numbers, never negative, and nothing at all when the post has no date.
 */
describe('shortAge', () => {
  const NOW = Date.parse('2026-10-22T12:00:00Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('says nothing for a missing or unreadable date', () => {
    expect(shortAge(null, NOW)).toBe('');
    expect(shortAge(undefined, NOW)).toBe('');
    expect(shortAge('not a date', NOW)).toBe('');
  });

  it('says "now" under a minute, and for a clock that runs ahead', () => {
    expect(shortAge(ago(30_000), NOW)).toBe('now');
    expect(shortAge(new Date(NOW + 5 * MIN).toISOString(), NOW)).toBe('now');
  });

  it('counts whole minutes, hours, days and weeks', () => {
    expect(shortAge(ago(MIN), NOW)).toBe('1 min');
    expect(shortAge(ago(59 * MIN + 59_000), NOW)).toBe('59 min');
    expect(shortAge(ago(2 * HOUR + 10 * MIN), NOW)).toBe('2 h');
    expect(shortAge(ago(23 * HOUR + 59 * MIN), NOW)).toBe('23 h');
    expect(shortAge(ago(DAY), NOW)).toBe('1 d');
    expect(shortAge(ago(6 * DAY + 23 * HOUR), NOW)).toBe('6 d');
    expect(shortAge(ago(7 * DAY), NOW)).toBe('1 w');
    expect(shortAge(ago(34 * DAY), NOW)).toBe('4 w');
  });

  it('gives a short date after five weeks, never a week count', () => {
    const out = shortAge(ago(40 * DAY), NOW);
    expect(out).not.toMatch(/\bw$/);
    expect(out).toMatch(/\d/);
  });
});
