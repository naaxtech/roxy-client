import type { ArchiveScore } from '../../lib/archive';

/**
 * The score said in words (design direction v2 › Archive: "4.4 from 7
 * members" in words, no green pill). One pattern for both kinds of score — an
 * average out of 5 and, before stars existed, a recommend share — so the
 * sample size always travels with the number and 100% is never bare.
 */
export function describeScore(score: ArchiveScore): string {
  if (!score.hasScore || score.total <= 0) return 'Not rated yet';
  const members = score.total === 1 ? 'member' : 'members';
  return `${score.label} from ${score.total} ${members}`;
}
