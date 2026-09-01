import { readFileSync } from 'fs';
import { join } from 'path';
import { formatScore, SCORE_GATE, verdictFor } from '../../lib/archive';

/**
 * One score, one question, and one gate.
 *
 * The Archive asks "would you recommend this to another wlw?" and shows a
 * single % recommend. The rule that makes that number mean anything is the
 * gate: below ten votes there is no percentage at all. One woman voting yes
 * must never render 100%, because a 100% on the browse list is the strongest
 * claim the Archive can make and it would be built out of one opinion.
 *
 * The gate lives in two places by necessity — this helper labels with it, and
 * `archive_entries.has_score` sorts with it, because "Top rated" leading with
 * an unearned 100% is the same bug in the ORDER BY. So the last test here reads
 * the threshold out of the migration and fails if the two ever disagree.
 */

describe('the vote gate', () => {
  it('shows no percentage under ten votes, and says how far off it is', () => {
    const s = formatScore(1, 1);
    expect(s.hasScore).toBe(false);
    expect(s.percent).toBeNull();
    expect(s.label).toBe('NEW · 1 vote');
  });

  it('pluralises honestly', () => {
    expect(formatScore(4, 9).label).toBe('NEW · 9 votes');
    expect(formatScore(0, 0).label).toBe('NEW · 0 votes');
  });

  it('opens exactly at ten, not at eleven', () => {
    expect(formatScore(9, 10).hasScore).toBe(true);
    expect(formatScore(9, 9).hasScore).toBe(false);
  });

  it('shows the percentage once the gate is passed', () => {
    const s = formatScore(9, 10);
    expect(s.percent).toBe(90);
    expect(s.label).toBe('90%');
  });

  it('rounds rather than truncating, so 2/3 is 67 and not 66', () => {
    expect(formatScore(20, 30).percent).toBe(67);
  });

  it('treats a total of zero as ungated rather than dividing by it', () => {
    expect(formatScore(0, 0).percent).toBeNull();
    expect(formatScore(0, 0).hasScore).toBe(false);
  });

  it('never reports more recommendations than votes', () => {
    // A denormalized up_count above vote_count means a trigger drifted. Showing
    // 120% would be the only visible symptom, so it is clamped and reported as
    // the ceiling rather than rendered as nonsense.
    expect(formatScore(12, 10).percent).toBe(100);
  });
});

describe('the verdict bands', () => {
  it('names each band at its boundary', () => {
    expect(verdictFor(90)).toBe('Community favourite');
    expect(verdictFor(75)).toBe('Worth your night');
    expect(verdictFor(50)).toBe('Divisive');
    expect(verdictFor(49)).toBe('Most of us said skip it');
  });

  it('holds each band one point below the next', () => {
    expect(verdictFor(89)).toBe('Worth your night');
    expect(verdictFor(74)).toBe('Divisive');
    expect(verdictFor(0)).toBe('Most of us said skip it');
    expect(verdictFor(100)).toBe('Community favourite');
  });

  it('has no verdict for an entry that has no score', () => {
    // A verdict under the gate would be the gate defeated by the sentence
    // underneath it.
    expect(formatScore(1, 1).verdict).toBeNull();
    expect(formatScore(9, 10).verdict).toBe('Community favourite');
  });
});

describe('the gate the database sorts by', () => {
  it('is the same number this helper labels with', () => {
    const sql = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '095_archive_core.sql'),
      'utf8'
    );
    const generated = sql.match(/has_score\s+boolean\s+GENERATED ALWAYS AS \(vote_count >= (\d+)\)/);
    expect(generated).not.toBeNull();
    expect(Number(generated![1])).toBe(SCORE_GATE);
  });
});
