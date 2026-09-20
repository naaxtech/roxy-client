#!/usr/bin/env node
/**
 * Apply ONE migration to the linked project and record it in the CLI's history.
 *
 *   node scripts/apply-migration.mjs 092_notification_links_roxy_3_0.sql
 *
 * Why this exists: `supabase db push` is unavailable in some environments (the
 * CLI shells out to a deno that may not be installed), and applying SQL by hand
 * without ALSO writing supabase_migrations.schema_migrations leaves the CLI
 * believing the migration never ran — which is how a history mismatch starts,
 * and this workspace already has one of those on another repo.
 *
 * One migration per invocation, on purpose. Nine in a loop that dies on the
 * fifth leaves a half-migrated database and no obvious record of where it
 * stopped; a caller that runs these one at a time always knows.
 *
 * Refuses to re-apply a version already in the history.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = readFileSync(resolve(root, 'supabase/.temp/project-ref'), 'utf8').trim();

const file = process.argv[2];
if (!file) { console.error('Usage: apply-migration.mjs <file.sql>'); process.exit(1); }
const path = resolve(root, 'supabase/migrations', file);
if (!existsSync(path)) { console.error(`No such migration: ${file}`); process.exit(1); }

const version = file.slice(0, file.indexOf('_'));
const name = file.replace(/^\d+_/, '').replace(/\.sql$/, '');
const sql = readFileSync(path, 'utf8');

async function run(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

const already = await run(
  `select version from supabase_migrations.schema_migrations where version = '${version}'`
);
if (already.ok && already.body.trim() !== '[]') {
  console.log(`SKIP ${file} — version ${version} is already in the history.`);
  process.exit(0);
}

console.log(`APPLYING ${file} …`);
const applied = await run(sql);
if (!applied.ok) {
  console.error(`FAILED ${file} (HTTP ${applied.status})`);
  console.error(applied.body.slice(0, 4000));
  process.exit(1);
}

// Record it, so the CLI's view of history matches the database's reality.
// `statements` is left as the whole file in one element: the CLI only reads it
// for `db diff`, and splitting SQL on semicolons is wrong the moment a function
// body contains one — which most of these migrations do.
const recorded = await run(
  `insert into supabase_migrations.schema_migrations (version, name, statements)
   values ('${version}', '${name.replace(/'/g, "''")}', array[$stmt$${sql}$stmt$])
   on conflict (version) do nothing`
);
if (!recorded.ok) {
  console.error(`APPLIED but NOT RECORDED — ${file}. Fix the history before pushing again.`);
  console.error(recorded.body.slice(0, 2000));
  process.exit(2);
}

console.log(`OK ${file}`);
