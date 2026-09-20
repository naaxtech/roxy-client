#!/usr/bin/env node
/**
 * Run SQL against the linked Supabase project over the Management API.
 *
 * `supabase db push` needs the CLI, and the CLI in this environment shells out
 * to a `deno` that is not installed — so the documented path to the database is
 * simply unavailable here. The Management API takes a bearer token
 * (SUPABASE_ACCESS_TOKEN, already in .env for the linked project) and runs
 * arbitrary SQL, which is enough to apply a migration and, more importantly,
 * to ASK the database what it actually contains.
 *
 * That second use is the point. "A migration file is not an applied migration"
 * is this workspace's most repeated lesson; this script is how you check
 * instead of assume.
 *
 *   node scripts/db-query.mjs "select count(*) from public.archive_entries"
 *   node scripts/db-query.mjs --file supabase/migrations/095_archive_core.sql
 *
 * Never prints the token. Exits non-zero on the first error so a caller can
 * stop rather than continue into a half-applied schema.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
  }
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF
  || (existsSync(resolve(root, 'supabase/.temp/project-ref'))
      ? readFileSync(resolve(root, 'supabase/.temp/project-ref'), 'utf8').trim()
      : null);

if (!token || !ref) {
  console.error('Missing SUPABASE_ACCESS_TOKEN in .env, or no linked project-ref.');
  process.exit(1);
}

const args = process.argv.slice(2);
const query = args[0] === '--file' ? readFileSync(resolve(root, args[1]), 'utf8') : args[0];
if (!query) { console.error('Usage: db-query.mjs "<sql>" | --file <path>'); process.exit(1); }

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});

const body = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  console.error(body.slice(0, 4000));
  process.exit(1);
}
console.log(body.slice(0, 8000));
