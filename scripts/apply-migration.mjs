#!/usr/bin/env node
/**
 * Apply ONE migration to a Supabase project and record it in the CLI's history.
 *
 *   node scripts/apply-migration.mjs 129_foo.sql --prod
 *   node scripts/apply-migration.mjs 129_foo.sql --ref <non-prod-ref>
 *   node scripts/apply-migration.mjs 129_foo.sql --prod --dry-run   # all gates + backup, no apply
 *
 * Gates (in order, all before a single write):
 *   1. target: the production ref requires --prod AND the ref typed back at a prompt
 *      (or ROXY_CONFIRM_REF=<ref> for a deliberate non-interactive run). --prod against
 *      a non-prod ref is refused too (catches a mis-linked supabase/.temp/project-ref).
 *   2. lint: `scripts/check-migrations.mjs --file <file>` must report no errors.
 *   3. local proof: supabase/.temp/verified-migrations.json (written by
 *      `npm run db:verify`, gitignored) must hold this file's sha256 — i.e. this exact
 *      content applied from zero on a local Postgres and every supabase/tests/*.sql
 *      passed. `--skip-local-proof` exists for emergencies and is loud about it.
 *   4. backup: scripts/backup-prod.mjs runs first (prod only); a failed backup aborts.
 *
 * Why this exists: `supabase db push` is unavailable in some environments (the
 * CLI shells out to a deno that may not be installed), and applying SQL by hand
 * without ALSO writing supabase_migrations.schema_migrations leaves the CLI
 * believing the migration never ran — which is how a history mismatch starts.
 *
 * One migration per invocation, on purpose. Nine in a loop that dies on the
 * fifth leaves a half-migrated database and no obvious record of where it
 * stopped; a caller that runs these one at a time always knows.
 *
 * Refuses to re-apply a version already in the history.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { ROOT, PROD_REF, loadEnv, resolveRef, makeClient, redact, migrationSha, PROOF_PATH } from './lib/supabase-mgmt.mjs';
import { runBackup, DEFAULT_BACKUP_ROOT } from './backup-prod.mjs';

const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

const argv = process.argv.slice(2);
const refIdx = argv.indexOf('--ref');
const explicitRef = refIdx !== -1 ? argv[refIdx + 1] : null;
const flags = new Set(argv.filter((a) => a.startsWith('--') && a !== '--ref'));
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--ref');
if (!file) die('Usage: apply-migration.mjs <NNN_name.sql> (--prod | --ref <ref>) [--dry-run] [--skip-local-proof]');

loadEnv();
const ref = resolveRef(explicitRef);
const isProd = ref === PROD_REF;
const name = basename(file);
const path = resolve(ROOT, 'supabase/migrations', name);
if (!existsSync(path)) die(`No such migration: ${name}`);
const sql = readFileSync(path, 'utf8');
const sha = migrationSha(sql);
const version = name.slice(0, name.indexOf('_'));
const label = name.replace(/^\d+_/, '').replace(/\.sql$/, '');

// ── gate 1: target ─────────────────────────────────────────────────────────
if (isProd && !flags.has('--prod')) die(`${ref} is PRODUCTION. Re-run with --prod if you mean it. Nothing applied.`);
if (!isProd && flags.has('--prod')) die(`--prod given but target ref ${ref} is not the production ref. Check supabase/.temp/project-ref.`);
if (isProd) {
  let typed = process.env.ROXY_CONFIRM_REF;
  if (!typed) {
    if (!process.stdin.isTTY) die('Production apply needs an interactive terminal (or ROXY_CONFIRM_REF=<ref>). Nothing applied.');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    typed = (await rl.question(`Applying ${name} to PRODUCTION. Type the project ref to continue: `)).trim();
    rl.close();
  }
  if (typed !== ref) die('Ref mismatch — aborted, nothing applied.');
}

// ── gate 2: lint ───────────────────────────────────────────────────────────
const lint = spawnSync(process.execPath, [join(ROOT, 'scripts/check-migrations.mjs'), '--file', name], { encoding: 'utf8' });
if (lint.status !== 0) die(`check-migrations failed for ${name}:\n${lint.stdout}${lint.stderr}\nNothing applied.`);
console.log(`gate lint OK (${name})`);

// ── gate 3: local proof ────────────────────────────────────────────────────
if (flags.has('--skip-local-proof')) {
  console.warn('!! --skip-local-proof: applying WITHOUT proof this migration applied locally from zero. Record why in the PR.');
} else {
  const proof = existsSync(PROOF_PATH) ? JSON.parse(readFileSync(PROOF_PATH, 'utf8')) : {};
  if (proof[name] !== sha) {
    die(`${name} (sha ${sha.slice(0, 12)}) has not passed the local database check.\n` +
        'Run `npm run db:verify` first (applies every migration from zero + runs supabase/tests). Nothing applied.');
  }
  console.log('gate local-proof OK (applied from zero + supabase/tests passed)');
}

const client = makeClient({ ref });
const already = await client.query(`select version from supabase_migrations.schema_migrations where version = '${version}'`);
if (already.length) { console.log(`SKIP ${name} — version ${version} is already in the history.`); process.exit(0); }

// ── gate 4: backup ─────────────────────────────────────────────────────────
if (isProd) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = resolve(process.env.ROXY_BACKUP_DIR || DEFAULT_BACKUP_ROOT, `${stamp}-pre-${version}`);
  try {
    const s = await runBackup({ ref, out, client });
    console.log(`gate backup OK: ${s.dir} (${s.tables} tables, ${s.rows} rows, ${s.auth_users} users)`);
  } catch (e) {
    die(`Backup FAILED — refusing to apply: ${redact(e.message)}`);
  }
}

if (flags.has('--dry-run')) { console.log(`DRY RUN — all gates passed; ${name} NOT applied.`); process.exit(0); }

console.log(`APPLYING ${name} …`);
try {
  await client.query(sql);
} catch (e) {
  die(`FAILED ${name}: ${redact(e.message).slice(0, 4000)}`);
}

// Record it, so the CLI's view of history matches the database's reality.
// `statements` is the whole file in one element: the CLI only reads it for
// `db diff`, and splitting on semicolons breaks on function bodies.
try {
  await client.query(
    `insert into supabase_migrations.schema_migrations (version, name, statements)
     values ('${version}', '${label.replace(/'/g, "''")}', array[$stmt$${sql}$stmt$])
     on conflict (version) do nothing`
  );
} catch (e) {
  die(`APPLIED but NOT RECORDED — ${name}. Fix the history before pushing again.\n${redact(e.message).slice(0, 2000)}`, 2);
}
console.log(`OK ${name}`);
