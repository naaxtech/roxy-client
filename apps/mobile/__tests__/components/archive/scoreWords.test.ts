import { describeScore } from '../../../components/archive/scoreWords';
import { formatScore } from '../../../lib/archive';

/**
 * Design direction v2 › Archive: the score is said in words ("4.4 from 7
 * members"), not painted as a green pill with a flower.
 */
describe('describeScore', () => {
  it('says the average out of 5 with its sample size', () => {
    expect(describeScore(formatScore(6, 7, 31))).toBe('4.4 from 7 members');
  });

  it('says the recommend share the same way when only thumbs exist', () => {
    expect(describeScore(formatScore(96, 100))).toBe('96% from 100 members');
  });

  it('uses the singular for one member', () => {
    expect(describeScore(formatScore(1, 1, 5))).toBe('5.0 from 1 member');
  });

  it('says plainly that nobody has rated it yet', () => {
    expect(describeScore(formatScore(0, 0))).toBe('Not rated yet');
  });

  it('never carries a flower or any other glyph', () => {
    for (const s of [formatScore(6, 7, 31), formatScore(96, 100), formatScore(0, 0), formatScore(10, 40)]) {
      expect(describeScore(s)).not.toMatch(/[✿❋🥀]/u);
    }
  });
});
