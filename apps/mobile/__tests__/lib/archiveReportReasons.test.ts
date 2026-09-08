import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Two places have to agree about why the WLW Archive can be reported, the same
 * way three places had to agree about what could be reported at all
 * (`reportContentTypes.test.ts`, migration 094).
 *
 * `submit-report/index.ts` used to require only that `reason` be truthy and
 * then pass it straight into the insert — an unrecognised value became an
 * opaque 23514 CHECK violation instead of a clear 400, exactly the bug 094
 * fixed for `content_type`. Migration 099 widens `reports.reason` to add
 * `archive_spoiler`, `archive_bad_entry` and `archive_review_abuse` so the
 * Archive's report button (spoilers, bad catalogue entries, and abuse of the
 * revision-review process itself) has somewhere to land; the edge function
 * gets its own `REPORT_REASONS` allowlist so a bad value is refused before it
 * ever reaches the database.
 *
 * A comment asking a future session to keep the two in step is not a
 * mechanism. This test is the mechanism: it reads the migration and the edge
 * function off disk and fails the moment either drifts from the other.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const MIGRATIONS = join(REPO, 'supabase', 'migrations');

/** The CHECK list from the LAST migration that constrains reports.reason. */
const checkedReasons = (): string[] => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let found: string[] | null = null;

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    // Any CHECK naming reason — the original column definition in 008 or a
    // later ADD CONSTRAINT that replaces it. Last one wins, which is what
    // Postgres ends up with too.
    const matches = sql.matchAll(/\breason\s+IN\s*\(([^)]*)\)/gi);
    for (const m of matches) {
      found = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '').replace(/'$/, ''));
    }
  }

  if (!found) throw new Error('No CHECK on reports.reason found in any migration');
  return found;
};

const edgeFunctionAllowlist = (): string[] => {
  const src = readFileSync(
    join(REPO, 'supabase', 'functions', 'submit-report', 'index.ts'),
    'utf8'
  );
  const match = src.match(/REPORT_REASONS\s*=\s*\[([^\]]*)\]/);
  if (!match) {
    throw new Error('submit-report does not declare REPORT_REASONS — it validates nothing');
  }
  return match[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
};

describe('why the Archive can be reported', () => {
  it('includes the three Archive-specific reasons', () => {
    const reasons = edgeFunctionAllowlist();
    expect(reasons).toContain('archive_spoiler');
    expect(reasons).toContain('archive_bad_entry');
    expect(reasons).toContain('archive_review_abuse');
  });

  it('matches the database CHECK exactly', () => {
    expect([...edgeFunctionAllowlist()].sort()).toEqual(checkedReasons().sort());
  });

  it('did not drop any of the five original reasons', () => {
    const reasons = edgeFunctionAllowlist();
    for (const original of ['harassment', 'spam', 'inappropriate', 'hate_speech', 'other']) {
      expect(reasons).toContain(original);
    }
  });
});
