import { readFileSync } from 'fs';
import { join } from 'path';
import {
  applyLocalStarVote,
  clampStars,
  formatScore,
  SCORE_GATE,
  starsToRecommend,
  verdictFor,
  firstVoteLanded,
} from '../../lib/archive';

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

describe('an entry nobody has rated', () => {
  it('says Unreviewed rather than showing a statistic built from nothing', () => {
    const s = formatScore(0, 0);
    expect(s.hasScore).toBe(false);
    expect(s.percent).toBeNull();
    expect(s.verdict).toBeNull();
    expect(s.label).toBe('Unreviewed');
  });
});

describe('an entry someone has rated', () => {
  it('shows the rating from the very first vote', () => {
    const s = formatScore(1, 1);
    expect(s.hasScore).toBe(true);
    expect(s.percent).toBe(100);
    expect(s.label).toBe('100%');
  });

  it('shows it at every count below the ranking gate too', () => {
    expect(formatScore(4, 9).percent).toBe(44);
    expect(formatScore(9, 10).percent).toBe(90);
  });

  it('carries the sample size, so a 100% off one vote is never bare', () => {
    // The rating shows from the first vote, but the number it rests on travels
    // with it. `total` is what every surface prints beside the percentage.
    expect(formatScore(1, 1).total).toBe(1);
    expect(formatScore(9, 10).total).toBe(10);
  });

  it('rounds rather than truncating, so 2/3 is 67 and not 66', () => {
    expect(formatScore(20, 30).percent).toBe(67);
  });

  it('never divides by zero', () => {
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

  it('has no verdict for an entry nobody has rated', () => {
    // There is nothing to summarise. A verdict over zero votes would be the
    // app inventing an opinion.
    expect(formatScore(0, 0).verdict).toBeNull();
  });

  it('has a verdict as soon as there is a rating to summarise', () => {
    expect(formatScore(1, 1).verdict).toBe('Community favourite');
    expect(formatScore(9, 10).verdict).toBe('Community favourite');
  });
});

describe('the gate the database RANKS by', () => {
  it('is the same number the client uses to decide what may be ranked', () => {
    const sql = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '095_archive_core.sql'),
      'utf8'
    );
    const generated = sql.match(/has_score\s+boolean\s+GENERATED ALWAYS AS \(vote_count >= (\d+)\)/);
    expect(generated).not.toBeNull();
    expect(Number(generated![1])).toBe(SCORE_GATE);
  });
});

describe('a 5-star community average', () => {
  it('labels the average out of 5 from the first rating', () => {
    const s = formatScore(0, 1, 5);
    expect(s.hasScore).toBe(true);
    expect(s.average).toBe(5);
    expect(s.label).toBe('5.0');
    expect(s.percent).toBe(100);
  });

  it('rounds the average to one decimal', () => {
    // 21 stars across 5 votes = 4.2
    const s = formatScore(0, 5, 21);
    expect(s.average).toBe(4.2);
    expect(s.label).toBe('4.2');
  });

  it('never reports more than 5.0', () => {
    expect(formatScore(0, 2, 20).average).toBe(5);
    expect(formatScore(0, 2, 20).label).toBe('5.0');
  });

  it('keeps the percent path when no star sum has been recorded yet', () => {
    expect(formatScore(84, 100).label).toBe('84%');
    expect(formatScore(84, 100).average).toBeNull();
  });

  it('does not treat a zero star sum as an average of 0.0', () => {
    expect(formatScore(84, 100, 0).label).toBe('84%');
    expect(formatScore(84, 100, 0).average).toBeNull();
  });
});

describe('clampStars / starsToRecommend', () => {
  it('keeps a rating inside 1–5', () => {
    expect(clampStars(0)).toBe(1);
    expect(clampStars(6)).toBe(5);
    expect(clampStars(3)).toBe(3);
  });

  it('treats 4 and 5 as a recommend for the legacy up-count', () => {
    expect(starsToRecommend(4)).toBe(true);
    expect(starsToRecommend(5)).toBe(true);
    expect(starsToRecommend(3)).toBe(false);
  });
});

describe('applyLocalStarVote', () => {
  const base = {
    vote_count: 10, up_count: 8, star_sum: 40,
  };

  it('adds a first rating to the tallies', () => {
    const next = applyLocalStarVote(base, undefined, 5);
    expect(next.vote_count).toBe(11);
    expect(next.star_sum).toBe(45);
    expect(next.up_count).toBe(9);
  });

  it('replaces an existing rating without growing the sample', () => {
    const next = applyLocalStarVote(base, 5, 2);
    expect(next.vote_count).toBe(10);
    expect(next.star_sum).toBe(37);
    expect(next.up_count).toBe(7);
  });
});

describe('firstVoteLanded', () => {
  it('is true only when she is the first person to rate it', () => {
    expect(firstVoteLanded(false, 0)).toBe(true);
    expect(firstVoteLanded(true, 0)).toBe(false);
    expect(firstVoteLanded(false, 3)).toBe(false);
  });
});
