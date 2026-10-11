import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { REPORT_CONTENT_TYPES } from '../../lib/reportTargets';

/**
 * Three places have to agree about what can be reported, and they did not.
 *
 * `safetyStore.reportTarget.contentType` was widened to include `room` and
 * `speed_date` when the live surfaces got report buttons, with a note saying the
 * edge function had to accept them "before the live surfaces are shipped". It
 * never did — and neither did the database: `008_safety.sql` constrains
 * `reports.content_type` to `('message','post','profile')`, and
 * `submit-report/index.ts` passes the client's value straight through to the
 * insert. So a woman reporting someone from inside a video date hit a CHECK
 * violation. On a safety product the report button is the control she reaches
 * for when a call turns threatening.
 *
 * A comment asking a future session to remember is not a mechanism. This test is
 * the mechanism: it reads the migration and the edge function off disk and fails
 * the moment any of the three drifts from the others.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const MIGRATIONS = join(REPO, 'supabase', 'migrations');

/**
 * The CHECK list from the LAST migration that constrains reports.content_type,
 * plus any type a later migration adds on top of whatever is there
 * (`reports_content_type_union := ARRAY[...]`, 135). 133 rebuilds the CHECK
 * from a literal list that predates 132's 'conversation', so 135 puts it back
 * as a union rather than a second literal list that would drop another lane's
 * type.
 */
const checkedContentTypes = (): string[] => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let found: string[] | null = null;

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    // Any CHECK naming content_type — the original column definition in 008 or
    // a later ADD CONSTRAINT that replaces it. Last one wins, which is what
    // Postgres ends up with too.
    const matches = sql.matchAll(/content_type\s+IN\s*\(([^)]*)\)/gi);
    for (const m of matches) {
      found = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    }
    for (const m of sql.matchAll(/reports_content_type_union\s*:=\s*ARRAY\[([^\]]*)\]/gi)) {
      const added = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
      found = [...new Set([...(found ?? []), ...added])];
    }
  }

  if (!found) throw new Error('No CHECK on reports.content_type found in any migration');
  return found;
}

const edgeFunctionAllowlist = (): string[] => {
  const src = readFileSync(
    join(REPO, 'supabase', 'functions', 'submit-report', 'index.ts'),
    'utf8'
  );
  const match = src.match(/REPORT_CONTENT_TYPES\s*=\s*\[([^\]]*)\]/);
  if (!match) {
    throw new Error('submit-report does not declare REPORT_CONTENT_TYPES — it validates nothing');
  }
  return match[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

describe('what can be reported', () => {
  it('includes the live surfaces, which is the whole point of widening it', () => {
    expect(REPORT_CONTENT_TYPES).toContain('room');
    expect(REPORT_CONTENT_TYPES).toContain('speed_date');
  });

  it('a whole conversation (a DM or a group) can be reported, not just one message', () => {
    // Migration 132: before it, the chat header had to point a report at "her
    // latest message", and a group with no message from the owner had nothing.
    expect(REPORT_CONTENT_TYPES).toContain('conversation');
  });

  it('the last migration to touch the CHECK keeps conversation reports (135 re-adds it after 133)', () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    const last = files
      .filter((f) => /reports_content_type_check/.test(readFileSync(join(MIGRATIONS, f), 'utf8')))
      .pop() as string;
    expect(readFileSync(join(MIGRATIONS, last), 'utf8'))
      .toMatch(/reports_content_type_union\s*:=\s*ARRAY\[[^\]]*'conversation'/);
  });

  it('matches the database CHECK exactly', () => {
    expect([...REPORT_CONTENT_TYPES].sort()).toEqual(checkedContentTypes().sort());
  });

  it('matches what the edge function will accept', () => {
    // The edge function must refuse an unknown value itself. Letting it through
    // to the insert turns a bad request into a CHECK violation, which reaches
    // the client as an opaque 23514 and tells her nothing.
    expect([...REPORT_CONTENT_TYPES].sort()).toEqual(edgeFunctionAllowlist().sort());
  });
});
