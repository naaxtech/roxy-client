import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The moderator's two actions, pinned in the migration text.
 *
 * Both were broken in production from the day migration 100 shipped, and each
 * broke for a different reason that no test could see:
 *
 *   update archive_reviews set status='removed'  -> 42501 permission denied
 *   update archive_entries set status='hidden'   -> 23514 archive_published_has_date
 *
 * On a safety product that is the worst shape a bug can take: the report queue
 * fills up, every action offered against it is a no-op, and the UI reports
 * success because PostgREST does not raise on a policy that matched no rows.
 *
 * There is no database in this environment — no Docker, so no `supabase db
 * reset` — so these read the migration text. They are not a substitute for the
 * live probes recorded in the commit; they are the part that can run in CI, and
 * they exist to catch a future edit that quietly reintroduces either hole.
 */

const sql = (name: string) =>
  readFileSync(join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', name), 'utf8');

const M106 = sql('106_moderator_can_actually_moderate.sql');
const DOWN = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'downs', '106_moderator_can_actually_moderate_down.sql'),
  'utf8',
);

const stripped = M106.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('hiding an entry', () => {
  it('uses an implication, never the biconditional that made hiding impossible', () => {
    // `(status = 'published') = (published_at IS NOT NULL)` forced a hidden
    // entry to have a NULL date, so hiding meant erasing the publication date
    // and un-hiding could never restore it.
    expect(stripped).toMatch(/check\s*\(\s*status\s*<>\s*'published'\s*or\s*published_at\s+is\s+not\s+null\s*\)/i);
    expect(stripped).not.toMatch(/\(status\s*=\s*'published'.*\)\s*=\s*\(published_at/i);
  });
});

describe('removing a review', () => {
  it('grants the status COLUMN, because RLS chooses rows and never columns', () => {
    expect(stripped).toMatch(/grant\s+update\s*\(\s*status\s*\)\s+on\s+public\.archive_reviews\s+to\s+authenticated/i);
  });

  it('pairs that grant with a guard, or the author could undo her own moderation', () => {
    // archive_reviews.status is ('published','removed') and
    // archive_reviews_update_own is USING (author_id = auth.uid()), so the
    // grant alone lets a removed review be set back to published by its author.
    expect(stripped).toMatch(/create\s+trigger\s+archive_reviews_guard_status/i);
    expect(stripped).toMatch(/is_roxy_staff\(\)/);
  });

  it('gates the guard on OLD.status, not on NEW alone', () => {
    // Reading only NEW lets the caller choose which rule applies to her.
    expect(stripped).toMatch(/new\.status\s+is\s+distinct\s+from\s+old\.status/i);
  });

  it('runs the guard BEFORE the update, where it can still refuse', () => {
    expect(stripped).toMatch(/before\s+update\s+on\s+public\.archive_reviews/i);
  });
});

describe('the entries grant', () => {
  it('is narrowed to what a moderator touches, so counters move only by trigger', () => {
    // The table-wide grant let anyone the staff policy admitted rewrite
    // vote_count and up_count by hand, around the trigger that recomputes them.
    expect(stripped).toMatch(/revoke\s+update\s+on\s+public\.archive_entries\s+from\s+authenticated/i);
    expect(stripped).toMatch(/grant\s+update\s*\(\s*status,\s*published_at,\s*updated_at\s*\)\s+on\s+public\.archive_entries/i);
  });

  it('takes the write grants away from anon', () => {
    // No policy has ever admitted anon — every write policy tests auth.uid(),
    // which is NULL for anon — but a grant that only a missing policy stands
    // between is one edit away from real.
    expect(stripped).toMatch(/revoke\s+insert,\s*update,\s*delete\s+on\s+public\.archive_entries\s+from\s+anon/i);
    expect(stripped).toMatch(/revoke\s+insert,\s*update,\s*delete\s+on\s+public\.archive_reviews\s+from\s+anon/i);
  });
});

describe('the down migration', () => {
  it('reverses every piece, so the forward one is not a one-way door', () => {
    for (const piece of [
      /drop\s+trigger[\s\S]*archive_reviews_guard_status/i,
      /drop\s+function[\s\S]*archive_reviews_guard_status/i,
      /revoke\s+update\s*\(\s*status\s*\)\s+on\s+public\.archive_reviews/i,
      /grant\s+update\s+on\s+public\.archive_entries\s+to\s+authenticated/i,
    ]) {
      expect(DOWN).toMatch(piece);
    }
  });
});

describe('migration 100', () => {
  it('no longer claims its policies scope columns, which policies cannot do', () => {
    const m100 = sql('100_archive_moderation_contract.sql');
    expect(m100).not.toMatch(/policies below are scoped to the\n--\s*exact columns/);
    // The correction has to say WHY, or the next reader re-derives the mistake.
    expect(m100).toMatch(/RLS chooses ROWS and never/i);
  });
});
