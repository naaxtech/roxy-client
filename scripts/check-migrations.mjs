#!/usr/bin/env node
/**
 * Migration-safety linter. Runs in CI (database job) and locally:
 *
 *   node scripts/check-migrations.mjs                 # base ref = origin/main
 *   node scripts/check-migrations.mjs --base HEAD~3   # compare to another ref
 *   node scripts/check-migrations.mjs --file 129_x.sql  # lint one file only (+ ordering)
 *   node scripts/check-migrations.mjs --json
 *
 * Rules (ERROR for migrations numbered > ENFORCE_AFTER, WARNING for older ones —
 * history 001–128 is already applied to production and is grandfathered):
 *
 *   naming        NNN_snake_case.sql
 *   duplicate     two files share a number
 *   ordering      a migration added on this branch is numbered <= the highest on the base ref
 *   down          no matching supabase/downs/<NNN>_*_down.sql
 *   destructive   DROP TABLE / DROP COLUMN / TRUNCATE / DELETE without WHERE /
 *                 ALTER COLUMN .. TYPE / RENAME — unless the file says
 *                 `-- destructive-ok: <reason>`
 *   rls           CREATE TABLE in public with no ENABLE ROW LEVEL SECURITY in the same file
 *   policy-to     CREATE POLICY with no TO clause (= TO public, which includes anon)
 *   search-path   SECURITY DEFINER function with no SET search_path
 *   anon-grant    GRANT ... TO anon
 *
 * Any rule except naming/duplicate/ordering can be waived per file with
 * `-- lint-ignore: <rule> <reason>` (reason mandatory). Waivers are printed, so
 * they show up in review.
 *
 * Exit code: 0 = clean (warnings allowed), 1 = at least one error.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ENFORCE_AFTER = 128;
export const NAME_RE = /^(\d{3,})_[a-z0-9_]+\.sql$/;

// ── SQL normalisation ─────────────────────────────────────────────────────
/**
 * Remove comments, single-quoted string contents and dollar-quoted bodies,
 * so rules see only top-level DDL. Function bodies are replaced by a
 * placeholder: a DELETE inside a plpgsql function is runtime behaviour, not a
 * migration step, and a `;` inside a body must not split a statement.
 */
export function stripSql(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === '-' && d === '-') {
      const j = sql.indexOf('\n', i);
      i = j === -1 ? n : j;
      continue;
    }
    if (c === '/' && d === '*') {
      const j = sql.indexOf('*/', i + 2);
      i = j === -1 ? n : j + 2;
      out += ' ';
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      out += "''";
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const j = sql.indexOf(tag, i + tag.length);
        out += ' $body$ ';
        i = j === -1 ? n : j + tag.length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

export function splitStatements(stripped) {
  return stripped
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const unquote = (id) => id.replace(/"/g, '').toLowerCase();

// ── per-file rules ────────────────────────────────────────────────────────
/**
 * Lint one migration's SQL. Returns [{rule, message}] (severity is decided by the caller).
 */
export function lintSql(sql) {
  const findings = [];
  const destructiveOk = /--[ \t]*destructive-ok:[ \t]*\S+/i.test(sql);
  const waived = new Set(
    [...sql.matchAll(/--[ \t]*lint-ignore:[ \t]*([a-z-]+)[ \t]+\S+/gi)].map((m) => m[1].toLowerCase())
  );
  const stmts = splitStatements(stripSql(sql));
  const push = (rule, message) => findings.push({ rule, message, waived: waived.has(rule) });

  // Tables that have RLS enabled somewhere in this file.
  const rlsEnabled = new Set();
  for (const s of stmts) {
    const m = /^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?((?:"?\w+"?\.)?"?\w+"?) ENABLE ROW LEVEL SECURITY/i.exec(s);
    if (m) rlsEnabled.add(unquote(m[1]).replace(/^public\./, ''));
  }
  // Functions whose search_path is pinned by a separate ALTER FUNCTION.
  const alteredSearchPath = new Set();
  for (const s of stmts) {
    const m = /^ALTER FUNCTION ((?:"?\w+"?\.)?"?\w+"?)[\s\S]*\bSET search_path\b/i.exec(s);
    if (m) alteredSearchPath.add(unquote(m[1]).replace(/^public\./, ''));
  }

  for (const s of stmts) {
    const S = s.toUpperCase();

    // destructive
    const destructive = [];
    if (/^DROP TABLE\b/.test(S)) destructive.push('DROP TABLE');
    if (/^ALTER TABLE\b/.test(S) && /\bDROP (COLUMN\b|(?!CONSTRAINT\b|DEFAULT\b|NOT NULL\b|IDENTITY\b|EXPRESSION\b)(IF EXISTS )?"?\w+"?\s*(,|$|CASCADE|RESTRICT))/.test(S)) {
      destructive.push('DROP COLUMN');
    }
    if (/^TRUNCATE\b/.test(S)) destructive.push('TRUNCATE');
    if (/^DELETE FROM\b/.test(S) && !/\bWHERE\b/.test(S)) destructive.push('DELETE without WHERE');
    if (/^ALTER TABLE\b/.test(S) && /\bALTER (COLUMN )?"?\w+"? (SET DATA )?TYPE\b/.test(S)) destructive.push('ALTER COLUMN TYPE');
    if (/^ALTER (TABLE|VIEW|MATERIALIZED VIEW|FUNCTION|TYPE|SCHEMA|INDEX|SEQUENCE)\b[\s\S]*\bRENAME\b/.test(S)) destructive.push('RENAME');
    if (destructive.length && !destructiveOk) {
      push('destructive', `${destructive.join(', ')}: "${s.slice(0, 120)}" — add \`-- destructive-ok: <reason>\` if intended (expand/contract!)`);
    }

    // rls
    const ct = /^CREATE (?:UNLOGGED )?TABLE (?:IF NOT EXISTS )?((?:"?\w+"?\.)?"?\w+"?)/i.exec(s);
    if (ct && !/^CREATE (TEMP|TEMPORARY)\b/.test(S)) {
      const full = unquote(ct[1]);
      const inPublic = !full.includes('.') || full.startsWith('public.');
      const name = full.replace(/^public\./, '');
      if (inPublic && !rlsEnabled.has(name)) {
        push('rls', `CREATE TABLE public.${name} without ALTER TABLE ... ENABLE ROW LEVEL SECURITY in the same file`);
      }
    }

    // policy-to
    if (/^CREATE POLICY\b/.test(S)) {
      const cut = S.search(/\b(USING|WITH CHECK)\b/);
      // Quoted policy names ("members can talk to mods") must not satisfy the TO check.
      const head = (cut === -1 ? S : S.slice(0, cut)).replace(/"[^"]*"/g, '"_"');
      if (!/\bTO\s+\S/.test(head)) {
        push('policy-to', `CREATE POLICY without TO clause (defaults to PUBLIC, includes anon): "${s.slice(0, 120)}"`);
      }
    }

    // search-path
    if (/^CREATE (OR REPLACE )?FUNCTION\b/.test(S) && /\bSECURITY DEFINER\b/.test(S) && !/\bSET SEARCH_PATH\b/.test(S)) {
      const fn = /FUNCTION ((?:"?\w+"?\.)?"?\w+"?)/i.exec(s);
      const name = fn ? unquote(fn[1]).replace(/^public\./, '') : '?';
      if (!alteredSearchPath.has(name)) {
        push('search-path', `SECURITY DEFINER function ${name} without SET search_path`);
      }
    }
    if (/^ALTER FUNCTION\b/.test(S) && /\bSECURITY DEFINER\b/.test(S) && !/\bSET SEARCH_PATH\b/.test(S)) {
      const fn = /FUNCTION ((?:"?\w+"?\.)?"?\w+"?)/i.exec(s);
      const name = fn ? unquote(fn[1]).replace(/^public\./, '') : '?';
      if (!alteredSearchPath.has(name)) push('search-path', `ALTER FUNCTION ${name} SECURITY DEFINER without SET search_path`);
    }

    // anon-grant
    if (/^GRANT\b/.test(S) && /\bTO\b[\s\S]*\bANON\b/.test(S)) {
      push('anon-grant', `GRANT to anon: "${s.slice(0, 120)}"`);
    }
  }
  return findings;
}

// ── repo-level checks ─────────────────────────────────────────────────────
function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Migration filenames present on a base ref, or null when the ref is unavailable. */
export function baseMigrations(root, base) {
  const out = git(root, ['ls-tree', '--name-only', `${base}:supabase/migrations`]);
  if (out === null) return null;
  return out.split(/\r?\n/).filter((f) => f.endsWith('.sql'));
}

/**
 * Pure core: given file lists and SQL contents, produce findings.
 * files: [{name, sql}], downs: [names], base: [names] | null
 */
export function checkMigrationSet({ files, downs, base, enforceAfter = ENFORCE_AFTER, only = null }) {
  const results = [];
  const add = (file, num, rule, message, waived = false) => {
    const enforced = num !== null && num > enforceAfter;
    results.push({ file, rule, message, severity: waived ? 'waived' : enforced ? 'error' : 'warning' });
  };

  const seen = new Map();
  for (const { name } of files) {
    const m = NAME_RE.exec(name);
    if (!m) { add(name, Infinity, 'naming', 'filename must match NNN_snake_case.sql'); continue; }
    const num = Number(m[1]);
    if (seen.has(num)) add(name, num, 'duplicate', `number ${m[1]} also used by ${seen.get(num)}`);
    else seen.set(num, name);
  }

  const baseSet = base ? new Set(base) : null;
  const baseMax = base
    ? Math.max(0, ...base.map((f) => NAME_RE.exec(f)).filter(Boolean).map((m) => Number(m[1])))
    : null;

  for (const { name, sql } of files) {
    if (only && name !== only) continue;
    const m = NAME_RE.exec(name);
    if (!m) continue;
    const num = Number(m[1]);
    const isNew = baseSet ? !baseSet.has(name) : false;

    if (isNew && num <= baseMax) {
      // New relative to base but numbered into the past: it would be skipped or
      // applied out of order on an environment that already has baseMax.
      add(name, Infinity, 'ordering', `new migration numbered ${m[1]} but base already reaches ${baseMax}; renumber above it`);
    }
    // Severity is by number only: history <= enforceAfter is grandfathered even
    // when the base ref is stale and it looks "new" relative to it.
    if (isNew || num > enforceAfter) {
      const hasDown = downs.some((d) => d.startsWith(`${m[1]}_`) && d.endsWith('_down.sql'));
      if (!hasDown) add(name, num, 'down', `missing supabase/downs/${m[1]}_*_down.sql`);
    }
    for (const f of lintSql(sql)) add(name, num, f.rule, f.message, f.waived);
  }
  return results;
}

export function runCheck({ root, base = 'origin/main', enforceAfter = ENFORCE_AFTER, only = null }) {
  const migDir = resolve(root, 'supabase/migrations');
  const downDir = resolve(root, 'supabase/downs');
  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(resolve(migDir, name), 'utf8') }));
  const downs = existsSync(downDir) ? readdirSync(downDir) : [];
  const baseList = base ? baseMigrations(root, base) : null;
  const results = checkMigrationSet({ files, downs, base: baseList, enforceAfter, only });
  return { results, baseAvailable: baseList !== null, count: files.length };
}

// ── CLI ───────────────────────────────────────────────────────────────────
function main(argv) {
  const args = { base: process.env.MIGRATION_BASE_REF || 'origin/main', json: false, only: null, enforceAfter: ENFORCE_AFTER };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') args.base = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--file') args.only = basename(argv[++i]);
    else if (a === '--enforce-after') args.enforceAfter = Number(argv[++i]);
    else if (a === '-h' || a === '--help') { console.log('usage: check-migrations.mjs [--base <ref>] [--file <name>] [--enforce-after N] [--json]'); return 0; }
    else { console.error(`unknown arg ${a}`); return 2; }
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { results, baseAvailable, count } = runCheck({ root, ...args });
  if (args.json) {
    console.log(JSON.stringify({ baseAvailable, count, results }, null, 2));
  } else {
    if (!baseAvailable) console.log(`note: base ref "${args.base}" not available — ordering/new-file checks skipped (fetch it: git fetch origin main)`);
    const by = (sev) => results.filter((r) => r.severity === sev);
    for (const sev of ['warning', 'waived', 'error']) {
      for (const r of by(sev)) console.log(`${sev.toUpperCase().padEnd(7)} ${r.file} [${r.rule}] ${r.message}`);
    }
    console.log(`\nchecked ${count} migrations (enforced > ${args.enforceAfter}): ${by('error').length} error(s), ${by('warning').length} grandfathered warning(s), ${by('waived').length} waived`);
  }
  return results.some((r) => r.severity === 'error') ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
