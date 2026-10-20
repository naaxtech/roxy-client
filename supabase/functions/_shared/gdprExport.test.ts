// Tests for the GDPR export assembler (_shared/gdprExport.ts) — PRO-03.
//
// Run from supabase/functions/:
//   deno test --no-check --allow-env _shared/gdprExport.test.ts
//
// The defect: "Download my data" returned {profile: 1, messages: 12, posts: 3}
// — counts, not a copy. Art. 15(3)/20 entitle her to the data itself. These
// tests pin three things: she gets her real rows, she gets ONLY her rows
// (every query is scoped to her id), and a failed read fails the export
// instead of handing her a silently partial file.

import { assembleExport, EXPORT_SECTIONS, type PageFn, type Filter } from './gdprExport.ts';

function eq(actual: unknown, expected: unknown, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  expected ${e}\n  received ${a}`);
}
function ok(cond: unknown, label: string) {
  if (!cond) throw new Error(label);
}

const ME = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-10-10T10:00:00Z');

type Call = { table: string; columns: string; filters: Filter[]; from: number; to: number };

/** A fake database: rows per table; the fake applies the filters it is given. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>, opts: { fail?: string; missing?: string[] } = {}) {
  const calls: Call[] = [];
  const page: PageFn = (table, columns, filters, from, to) => {
    calls.push({ table, columns, filters, from, to });
    if (opts.fail === table) return Promise.resolve({ data: null, error: { message: 'boom' } });
    if (opts.missing?.includes(table)) {
      return Promise.resolve({ data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } });
    }
    let rows = tables[table] ?? [];
    for (const f of filters) {
      rows = rows.filter((r) => r[f.col] === f.value);
    }
    const cols = columns === '*' ? null : columns.split(',').map((c) => c.trim());
    const shaped = rows.slice(from, to + 1).map((r) =>
      cols ? Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])) : r
    );
    return Promise.resolve({ data: shaped, error: null });
  };
  return { page, calls };
}

const gate = () => Promise.resolve({ application: { legal_name: 'Her Name' } });

Deno.test('the export carries her real rows, not counts', async () => {
  const { page } = fakeDb({
    profiles: [{ id: ME, display_name: 'Maya', bio: 'hi' }, { id: 'other', display_name: 'X' }],
    posts: [
      { id: 'p1', author_id: ME, content: 'my first post', created_at: '2026-10-01' },
      { id: 'p2', author_id: 'other', content: 'not mine', created_at: '2026-10-02' },
    ],
    messages: [
      { id: 'm1', sender_id: ME, conversation_id: 'c1', content: 'hey', created_at: '2026-10-03' },
      { id: 'm2', sender_id: 'other', conversation_id: 'c1', content: 'their words', created_at: '2026-10-04' },
    ],
    comments: [{ id: 'k1', author_id: ME, post_id: 'p2', content: 'lovely', created_at: '2026-10-05' }],
    follows: [
      { follower_id: ME, followed_id: 'u2', created_at: '2026-10-01' },
      { follower_id: 'u3', followed_id: ME, created_at: '2026-10-01' },
    ],
    archive_votes: [{ entry_id: 'e1', profile_id: ME, stars: 5, value: true, created_at: '2026-10-01' }],
    archive_reviews: [{ id: 'r1', entry_id: 'e1', author_id: ME, body: 'loved it', created_at: '2026-10-01' }],
    archive_watchlist: [{ entry_id: 'e2', profile_id: ME, created_at: '2026-10-01' }],
  });
  const out = await assembleExport(ME, page, gate, NOW);

  eq((out.profile as Record<string, unknown>).id, ME);
  eq((out.profile as Record<string, unknown>).display_name, 'Maya');
  eq((out.posts as unknown[]).length, 1);
  eq(((out.posts as Record<string, unknown>[])[0]).content, 'my first post');
  eq(((out.messages_sent as Record<string, unknown>[])[0]).content, 'hey');
  eq(((out.comments as Record<string, unknown>[])[0]).content, 'lovely');
  const archive = out.archive as Record<string, Record<string, unknown>[]>;
  eq(archive.votes[0].stars, 5);
  eq(archive.reviews[0].body, 'loved it');
  eq(archive.watchlist[0].entry_id, 'e2');
  const conn = out.connections as Record<string, Record<string, unknown>[]>;
  eq(conn.following.map((r) => r.followed_id), ['u2']);
  eq(conn.followers.map((r) => r.follower_id), ['u3']);
  eq((out.membership as Record<string, unknown>).application, { legal_name: 'Her Name' });
  eq(out.generated_at, NOW.toISOString());
  eq(out.user_id, ME);
});

Deno.test('nothing that is not hers: other people\'s posts and messages never appear', async () => {
  const { page } = fakeDb({
    posts: [{ id: 'p2', author_id: 'other', content: 'not mine', created_at: '2026-10-02' }],
    messages: [{ id: 'm2', sender_id: 'other', conversation_id: 'c1', content: 'their words', created_at: '2026-10-04' }],
  });
  const out = await assembleExport(ME, page, gate, NOW);
  const text = JSON.stringify(out);
  ok(!text.includes('their words'), 'a message she received (the sender\'s words) leaked into her export');
  ok(!text.includes('not mine'), 'someone else\'s post leaked into her export');
});

Deno.test('every query is scoped to her id', async () => {
  const { page, calls } = fakeDb({});
  await assembleExport(ME, page, gate, NOW);
  ok(calls.length >= EXPORT_SECTIONS.length, 'expected one query per section at least');
  for (const c of calls) {
    ok(
      c.filters.some((f) => f.op === 'eq' && f.value === ME),
      `${c.table} was read without a filter on her id: ${JSON.stringify(c.filters)}`,
    );
  }
});

Deno.test('internal columns are never selected (reviewer identity, staff notes, other people\'s ids on reports)', async () => {
  const { calls } = fakeDb({});
  const { page } = fakeDb({});
  await assembleExport(ME, page, gate, NOW);
  for (const s of EXPORT_SECTIONS) {
    ok(!/\breviewed_by\b/.test(s.columns), `${s.table} selects reviewed_by`);
    ok(!/\binternal_notes\b/.test(s.columns), `${s.table} selects internal_notes`);
    if (s.table === 'reports') ok(!/reported_user_id|content_id/.test(s.columns), 'reports names the reported person');
  }
  eq(calls.length, 0);
});

Deno.test('long histories are read in full, page by page', async () => {
  const many = Array.from({ length: 2500 }, (_, i) => ({
    id: `m${i}`, sender_id: ME, conversation_id: 'c1', content: `msg ${i}`, created_at: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
  }));
  const { page, calls } = fakeDb({ messages: many });
  const out = await assembleExport(ME, page, gate, NOW);
  eq((out.messages_sent as unknown[]).length, 2500);
  eq(calls.filter((c) => c.table === 'messages').length, 3, 'three pages of 1000');
  eq((out.summary as Record<string, number>).messages, 2500);
});

Deno.test('a failed read fails the export instead of handing her a partial file', async () => {
  const { page } = fakeDb({}, { fail: 'messages' });
  let threw = false;
  try {
    await assembleExport(ME, page, gate, NOW);
  } catch {
    threw = true;
  }
  ok(threw, 'expected the export to fail');
});

Deno.test('a table that is not deployed yet is named, not fatal', async () => {
  const { page } = fakeDb({}, { missing: ['profile_prompts', 'archive_shelf'] });
  const out = await assembleExport(ME, page, gate, NOW);
  eq(out.not_available, ['profile_prompts', 'archive_shelf']);
});

Deno.test('the withheld list is disclosed, as before', async () => {
  const { page } = fakeDb({});
  const out = await assembleExport(ME, page, gate, NOW);
  const withheld = out.withheld as string[];
  ok(withheld.includes('internal_safety_assessment'), 'internal_safety_assessment');
  ok(withheld.includes('reviewer_access_log'), 'reviewer_access_log');
  ok(withheld.some((w) => w.startsWith('messages_received')), 'messages_received');
});
