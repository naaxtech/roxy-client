#!/usr/bin/env node
/**
 * Read-only logical backup of the Roxy Supabase project via the Management API.
 *
 *   node scripts/backup-prod.mjs                      # -> D:/Work/Development/JoNicole/_backups/roxy/<ts>/
 *   node scripts/backup-prod.mjs --out <dir>          # any directory OUTSIDE the repo
 *   node scripts/backup-prod.mjs --ref <projectref>   # default: SUPABASE_PROJECT_REF or supabase/.temp/project-ref
 *   node scripts/backup-prod.mjs --quiet              # summary line only
 *
 * What it captures:
 *   public.<table>.json       every row of every public base table (paged, ordered by ctid)
 *   auth.users.json           minimal columns only — NO password hashes, NO tokens
 *   storage.objects.json      object metadata (bucket, path, owner, size/mime) — not the bytes
 *   schema_migrations.json    applied migration history
 *   manifest.json             row counts + sha256 per file, ref, timestamp, CLI version
 *
 * Safety:
 *   - every statement is a generated SELECT and passes assertReadOnly() before it is sent
 *   - refuses to write inside the git repo (backups contain user PII)
 *   - never prints tokens, keys, or row data; errors are redacted
 *
 * This is NOT a substitute for platform backups/PITR (Supabase Pro). It is a
 * restore-of-last-resort for data; schema is rebuilt from supabase/migrations.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, loadEnv, resolveRef, makeClient, redact } from './lib/supabase-mgmt.mjs';

export const DEFAULT_BACKUP_ROOT = 'D:/Work/Development/JoNicole/_backups/roxy';
const PAGE = 2000;

/** Only single SELECT/WITH statements may be sent by this script. */
export function assertReadOnly(sql) {
  const s = sql.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(s)) throw new Error('backup-prod: refusing non-SELECT statement');
  if (s.includes(';')) throw new Error('backup-prod: refusing multi-statement query');
  if (/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|call|do)\b\s/i.test(s.replace(/"[^"]*"/g, '""'))) {
    throw new Error('backup-prod: refusing statement containing a write keyword');
  }
  return s;
}

export function isInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const qi = (id) => `"${id.replace(/"/g, '""')}"`;

export async function runBackup({ ref, out, client, log = () => {} }) {
  if (isInside(out, ROOT)) throw new Error(`refusing to write a PII backup inside the repo (${out})`);
  mkdirSync(out, { recursive: true });
  const q = (sql) => client.query(assertReadOnly(sql));
  const manifest = { ref, taken_at: new Date().toISOString(), files: {}, tables: {} };
  const write = (name, data) => {
    const body = JSON.stringify(data);
    writeFileSync(join(out, name), body);
    manifest.files[name] = { sha256: createHash('sha256').update(body).digest('hex'), bytes: Buffer.byteLength(body) };
  };

  const pagedDump = async (fromSql, label) => {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const r = await q(
        `select coalesce(json_agg(x), '[]'::json) as j from (${fromSql} order by ctid limit ${PAGE} offset ${offset}) x`
      );
      const page = r[0].j;
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    log(`  ${label}: ${rows.length}`);
    return rows;
  };

  const tables = (
    await q(`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r','p') order by 1`)
  ).map((x) => x.t);

  let total = 0;
  for (const t of tables) {
    const rows = await pagedDump(`select * from public.${qi(t)}`, `public.${t}`);
    write(`public.${t}.json`, rows);
    manifest.tables[`public.${t}`] = rows.length;
    total += rows.length;
  }

  const users = await pagedDump(
    `select id, email, phone, created_at, updated_at, last_sign_in_at, email_confirmed_at,
            banned_until, deleted_at, is_anonymous, raw_app_meta_data, raw_user_meta_data from auth.users`,
    'auth.users'
  );
  write('auth.users.json', users);
  manifest.tables['auth.users'] = users.length;

  const objects = await pagedDump(
    `select id, bucket_id, name, owner, created_at, updated_at, metadata from storage.objects`,
    'storage.objects'
  );
  write('storage.objects.json', objects);
  manifest.tables['storage.objects'] = objects.length;

  const buckets = await q(`select coalesce(json_agg(x), '[]'::json) as j from (select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id) x`);
  write('storage.buckets.json', buckets[0].j);

  const mig = await q(`select coalesce(json_agg(x order by x.version), '[]'::json) as j from (select version, name from supabase_migrations.schema_migrations) x`);
  write('schema_migrations.json', mig[0].j);
  manifest.tables['schema_migrations'] = mig[0].j.length;
  manifest.latest_migration = mig[0].j.at(-1)?.version ?? null;

  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return {
    dir: out,
    tables: tables.length,
    rows: total,
    auth_users: users.length,
    storage_objects: objects.length,
    migrations: mig[0].j.length,
    latest_migration: manifest.latest_migration,
  };
}

async function main(argv) {
  const args = { out: null, ref: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--ref') args.ref = argv[++i];
    else if (argv[i] === '--quiet') args.quiet = true;
    else { console.error(`unknown arg ${argv[i]}`); return 2; }
  }
  loadEnv();
  const ref = resolveRef(args.ref);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = resolve(args.out ?? join(process.env.ROXY_BACKUP_DIR || DEFAULT_BACKUP_ROOT, stamp));
  const log = args.quiet ? () => {} : (m) => console.log(m);
  log(`backup of ${ref} -> ${out}`);
  const summary = await runBackup({ ref, out, client: makeClient({ ref }), log });
  console.log(JSON.stringify(summary));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (c) => (process.exitCode = c),
    (e) => { console.error(`backup FAILED: ${redact(e.message)}`); process.exitCode = 1; }
  );
}
