#!/usr/bin/env node
/**
 * Record that the CURRENT content of every migration passed the local database
 * check. Called by scripts/db-verify.sh only after all migrations applied from
 * zero and every supabase/tests/*.sql passed. apply-migration.mjs refuses to
 * touch production for a migration whose sha is not in this ledger.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ROOT, PROOF_PATH, migrationSha } from './lib/supabase-mgmt.mjs';

const dir = resolve(ROOT, 'supabase/migrations');
const ledger = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  ledger[f] = migrationSha(readFileSync(resolve(dir, f), 'utf8'));
}
mkdirSync(dirname(PROOF_PATH), { recursive: true });
writeFileSync(PROOF_PATH, JSON.stringify(ledger, null, 2));
console.log(`local proof recorded for ${Object.keys(ledger).length} migrations -> ${PROOF_PATH}`);
