import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';

/** One tappable answer, and the `reaction_counts` key its votes land in. */
export interface PollOption {
  key: string;
  label: string;
}

export interface ParsedPoll {
  question: string;
  options: PollOption[];
}

/**
 * A poll's options live in the post body, not in a table.
 *
 * `posts.post_type` has allowed `'poll'` since migration 005 and every seeded
 * poll writes its answers as a bulleted list under the question — there has
 * never been a `poll_options` or `poll_votes` table. So the cell parses what the
 * composer already writes rather than inventing a schema this slice is not
 * allowed to add.
 *
 * Bullets, dashes, asterisks and numbers are all accepted, because a human
 * typing a poll into a text box will use whichever one her keyboard offers.
 */
const OPTION_LINE = /^\s*(?:[•·‣▪▸●◦]|[-*+]|\d{1,2}[.)])\s*(.*)$/;

/** Enough for any real poll; a cap stops a pathological body rendering forever. */
const MAX_OPTIONS = 10;

export function parsePoll(content: string): ParsedPoll | null {
  const lines = content.split('\n');
  const questionLines: string[] = [];
  const options: PollOption[] = [];
  let seenOption = false;

  for (const line of lines) {
    const match = OPTION_LINE.exec(line);
    if (match) {
      seenOption = true;
      const label = match[1].trim();
      // A marker with nothing after it is formatting, not an answer.
      if (label && options.length < MAX_OPTIONS) {
        options.push({ key: `poll:${options.length}`, label });
      }
      continue;
    }
    // Anything after the first option is trailing prose, not part of the ask.
    if (!seenOption && line.trim()) questionLines.push(line.trim());
  }

  const question = questionLines.join('\n');
  // A question with one answer is not a poll, and answers with no question are
  // a list. Either way the text treatment reads better than a broken poll.
  if (!question || options.length < 2) return null;
  return { question, options };
}

/** Non-negative whole votes only — `reaction_counts` is free-form jsonb. */
function safeCount(counts: Record<string, number>, key: string): number {
  const raw = counts[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return Math.trunc(raw);
}

/**
 * Votes cast in THIS poll.
 *
 * `reaction_counts` is shared with emoji reactions, so the total is summed over
 * the poll's own keys rather than over the whole map.
 */
export function pollVoteTotal(
  counts: Record<string, number>,
  options: PollOption[],
): number {
  return options.reduce((sum, option) => sum + safeCount(counts, option.key), 0);
}

/** This option's share of the vote, 0..1. Zero before anyone has voted. */
export function pollShare(
  counts: Record<string, number>,
  option: PollOption,
  total: number,
): number {
  if (total <= 0) return 0;
  return safeCount(counts, option.key) / total;
}

/**
 * Record a vote.
 *
 * `increment_reaction` is the only atomic write this schema offers against a
 * post's `reaction_counts`, and it is `SECURITY DEFINER` with `EXECUTE` granted
 * to `authenticated`, so a vote is a single round trip that cannot lose a race
 * with a concurrent voter.
 *
 * It stores a TALLY, not a ballot: there is no per-viewer row, so a vote is
 * remembered for the life of the cell and not across a reload, and nothing
 * server-side stops a determined viewer voting twice. A `poll_votes` table with
 * `TO authenticated` RLS and a `(post_id, user_id)` primary key is the fix, and
 * it is a schema slice of its own.
 *
 * src: supabase/migrations/010_increment_reaction.sql · 2026-08-06
 */
export async function submitPollVote(postId: string, optionKey: string): Promise<boolean> {
  const { error } = await supabase.rpc('increment_reaction', {
    p_post_id: postId,
    p_emoji: optionKey,
  });
  if (error) {
    logError(error, 'submitPollVote');
    return false;
  }
  return true;
}
