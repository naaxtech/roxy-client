import { applyLocalStarWithdraw, applyLocalStarVote } from '../../lib/archive';

/**
 * "0 star to 5 stars exactly."
 *
 * Zero is not a value the column can hold — `archive_vote_stars_range` is
 * CHECK (stars >= 1 AND stars <= 5) — and it should not be. "I have not rated
 * this" is the ABSENCE of a row, not a row saying nothing. So the UI's zero
 * becomes a delete, and these are the counters that have to follow it back.
 */

const entry = (over: Partial<{ vote_count: number; up_count: number; star_sum: number }> = {}) => ({
  vote_count: 10, up_count: 6, star_sum: 38, ...over,
});

describe('applyLocalStarWithdraw', () => {
  it('takes the vote, the stars and the recommend back out', () => {
    const out = applyLocalStarWithdraw(entry(), 5);
    expect(out.vote_count).toBe(9);
    expect(out.star_sum).toBe(33);
    // 5 counted as a recommend, so it leaves with her.
    expect(out.up_count).toBe(5);
  });

  it('leaves up_count alone when the withdrawn vote was never a recommend', () => {
    // Only 4 and 5 count toward the legacy up tally.
    const out = applyLocalStarWithdraw(entry(), 2);
    expect(out.up_count).toBe(6);
    expect(out.vote_count).toBe(9);
    expect(out.star_sum).toBe(36);
  });

  it('does nothing when she had not rated it', () => {
    expect(applyLocalStarWithdraw(entry(), undefined)).toEqual(entry());
  });

  it('never renders a negative count when the local estimate has drifted', () => {
    // The optimistic number is an estimate; the next fetch corrects it. What it
    // must never do in the meantime is show "-1 members voted".
    const out = applyLocalStarWithdraw({ vote_count: 0, up_count: 0, star_sum: 0 }, 5);
    expect(out.vote_count).toBe(0);
    expect(out.up_count).toBe(0);
    expect(out.star_sum).toBe(0);
  });

  it('exactly undoes a vote it follows — the pair must round-trip', () => {
    const before = entry();
    const rated = applyLocalStarVote(before, undefined, 4);
    expect(applyLocalStarWithdraw(rated, 4)).toEqual(before);
  });

  it('round-trips a change of mind too', () => {
    const before = entry();
    const rated = applyLocalStarVote(before, undefined, 1);
    const changed = applyLocalStarVote(rated, 1, 5);
    expect(applyLocalStarWithdraw(changed, 5)).toEqual(before);
  });
});
