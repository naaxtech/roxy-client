// Shared helpers for scripts that talk to the Supabase Management API.
// Never prints secret values. Reads process.env first, then the repo-root .env
// (only for keys not already set), so CI can pass everything via env.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROD_REF = 'ptymtdlysqbpxzlgsshp';

/**
 * Local proof ledger: migration filename -> sha256 of its LF-normalised content,
 * written by scripts/record-local-proof.mjs after `npm run db:verify` passes.
 * Lives under supabase/.temp (gitignored) — it is a per-machine attestation.
 */
export const PROOF_PATH = resolve(ROOT, 'supabase/.temp/verified-migrations.json');
export const migrationSha = (sql) => createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

export function loadEnv(root = ROOT) {
  const p = resolve(root, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
}

export function resolveRef(explicit, root = ROOT) {
  if (explicit) return explicit;
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const p = resolve(root, 'supabase/.temp/project-ref');
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  throw new Error('no project ref: pass --ref, set SUPABASE_PROJECT_REF, or `supabase link`');
}

/** Redact anything token-shaped from an error body before it is printed. */
export function redact(s) {
  return String(s)
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
    .replace(/sbp_[A-Za-z0-9]{20,}/g, '[pat]')
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/g, '[key]');
}

export function makeClient({ ref, token = process.env.SUPABASE_ACCESS_TOKEN, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxRetries = 6 }) {
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  if (!/^[a-z]{20}$/.test(ref)) throw new Error(`project ref looks wrong (${ref.length} chars)`);
  const base = `https://api.supabase.com/v1/projects/${ref}`;
  // The Management API throttles bursts (HTTP 429 "ThrottlerException"). A full
  // backup sends one query per table page, so it trips the limit part-way.
  // Retry ONLY 429 with backoff (honouring Retry-After); every other status fails at once.
  async function send(url, init) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, init);
      if (res.status !== 429 || attempt >= maxRetries) return res;
      const after = Number(res.headers?.get?.('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : Math.min(30000, 2000 * 2 ** attempt));
    }
  }
  return {
    ref,
    async query(sql) {
      const res = await send(`${base}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${redact(body).slice(0, 500)}`);
      return JSON.parse(body);
    },
    async get(path) {
      const res = await send(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${redact(body).slice(0, 500)}`);
      return JSON.parse(body);
    },
  };
}
