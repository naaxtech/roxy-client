// The rule, made executable.
//
// Run from supabase/functions/:
//   deno test --no-check --allow-read _shared/rateLimit.guard.test.ts
//
// `checkRateLimit` and `logAiCall` were two halves of one decision: one counted
// rows in ai_call_log, the other wrote them, and nothing made a caller do both.
// Six of twelve callers never did, so six caps were unenforced from the day they
// were written until 2026-08-07 — verified against production, where those six
// function names had zero rows between them.
//
// `consumeRateLimit` cannot be misused that way, because the recording IS the
// count. This file exists so the old shape cannot come back.
//
// Why a grep test and not the type checker: CI runs `deno test --no-check`
// (.github/workflows/ci.yml) because stripe-node 14.25.0 pins an apiVersion its
// types disagree with. Nothing type-checks these files. Deleting the old exports
// therefore buys no build-time safety at all — a function still importing them
// would compile fine here and fail in production, on a woman's request. A test
// that reads the source is the only gate that actually runs.

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const FUNCTIONS_DIR = new URL('../', import.meta.url);

/**
 * Comments are stripped before matching.
 *
 * Without this, the first assertion fails on `_shared/rateLimit.ts` itself,
 * because that file's doc comment explains at length what `checkRateLimit` and
 * `logAiCall` were and why they are gone. Exempting the file by name would be
 * the easy fix and the wrong one — that is precisely the file where a
 * reintroduced export would live. Strip the prose, keep the file in scope.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * A file may opt out of the ledger rule with
 *   // rate-limit-ledger-exempt: <reason>
 * on the line before the call. Greppable, and it forces the reason to be
 * written down rather than assumed.
 */
const EXEMPT = /rate-limit-ledger-exempt:/;

/** Every edge function entry point, plus the shared modules they lean on. */
async function sourceFiles(): Promise<{ path: string; text: string; raw: string }[]> {
  const out: { path: string; text: string; raw: string }[] = [];

  for await (const entry of Deno.readDir(FUNCTIONS_DIR)) {
    if (!entry.isDirectory) continue;

    for await (const file of Deno.readDir(new URL(`${entry.name}/`, FUNCTIONS_DIR))) {
      if (!file.isFile || !file.name.endsWith('.ts')) continue;
      // A test may legitimately name the banned symbols while explaining them.
      if (file.name.endsWith('.test.ts')) continue;

      const path = `${entry.name}/${file.name}`;
      const raw = await Deno.readTextFile(new URL(path, FUNCTIONS_DIR));
      out.push({ path, raw, text: stripComments(raw) });
    }
  }

  return out;
}

Deno.test('no edge function imports the split rate-limit API', async () => {
  const files = await sourceFiles();
  assert(files.length > 0, 'found no edge function sources — the walk is broken, not the code');

  const offenders: string[] = [];
  for (const { path, text } of files) {
    // Matches the import and any call. `checkRateLimit`/`logAiCall` no longer
    // exist in _shared/rateLimit.ts; a reference is either a stale caller or a
    // reintroduction.
    if (/\b(checkRateLimit|logAiCall)\b/.test(text)) offenders.push(path);
  }

  assert(
    offenders.length === 0,
    `these files still use the split rate-limit API, whose two halves can be used ` +
      `independently — that is what left six caps unenforced. Use consumeRateLimit ` +
      `instead:\n  ${offenders.join('\n  ')}`,
  );
});

Deno.test('every consumeRateLimit call states its failure policy', async () => {
  const files = await sourceFiles();

  const offenders: string[] = [];
  for (const { path, text } of files) {
    if (path.startsWith('_shared/')) continue;
    if (!/\bconsumeRateLimit\s*\(/.test(text)) continue;
    if (!/\bonLimiterFailure\s*:/.test(text)) offenders.push(path);
  }

  // TypeScript already requires the field, but nothing type-checks these files
  // in CI (see the header), so "required" is currently a claim rather than a
  // gate. This is the gate.
  assert(
    offenders.length === 0,
    `these files call consumeRateLimit without onLimiterFailure. There is no ` +
      `default on purpose: when the limiter itself fails, refusing a woman her ` +
      `abuse report and refusing her an uncapped payment attempt are opposite ` +
      `answers, and the wrong one is invisible:\n  ${offenders.join('\n  ')}`,
  );
});

Deno.test('nothing writes the rate-limit ledger except the limiter', async () => {
  const files = await sourceFiles();

  // Writes only. A READ of ai_call_log is a different smell — roxy-sister
  // derives its turn number from one — but a read cannot forge a slot, and the
  // fix there is to use the count consumeRateLimit already returns rather than
  // to ban the query. Writes are what break the ledger.
  const WRITE = /from\s*\(\s*['"]ai_call_log['"]\s*\)[\s\S]{0,200}?\.(insert|upsert|update|delete)\s*\(/;

  const offenders: string[] = [];
  for (const { path, text, raw } of files) {
    if (path.startsWith('_shared/')) continue;
    if (!WRITE.test(text)) continue;
    if (EXEMPT.test(raw)) continue;
    offenders.push(path);
  }

  assert(
    offenders.length === 0,
    `these files write ai_call_log directly. It is the rate-limit ledger, and a ` +
      `write that bypasses consume_rate_limit re-creates the split this module ` +
      `removed — a row the counter did not authorise, or a count the writer ` +
      `never joined. If a file genuinely needs it, mark the call with ` +
      `"// rate-limit-ledger-exempt: <reason>":\n  ${offenders.join('\n  ')}`,
  );
});
