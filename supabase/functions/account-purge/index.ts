import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { runAccountPurge } from '../_shared/accountPurge.ts';

/**
 * account-purge — erases accounts deleted more than 30 days ago (G-16).
 *
 * gdpr-delete soft-deletes and promises "within 30 days". This finishes it:
 * purge_deleted_accounts() (migration 134) hard-deletes the auth user (every
 * row of hers cascades) and records the id; her Storage files are then removed
 * through the Storage API, because Supabase refuses direct DELETEs on
 * storage.objects. Accounts with orders or payment logs are kept (accounts
 * law), and counted in the summary as `kept`.
 *
 * Caller: a daily pg_cron job (scripts/setup-cron.sql, ops lane:
 * `roxy-account-purge`, via ops_invoke_edge('account-purge')). No user is
 * involved: `verify_jwt = false` in config.toml and the service-role key is
 * compared here before any work is done. Decisions are in
 * _shared/accountPurge.ts (tested); this file is only I/O.
 */

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const presented = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!serviceKey || !constantTimeEqual(presented, serviceKey)) return errorResponse('Unauthorized', 401);

  const db = getSupabaseClient();
  try {
    const summary = await runAccountPurge({
      async purgeAccounts() {
        const { data, error } = await db.rpc('purge_deleted_accounts');
        if (error) throw error;
        return (data ?? {}) as Record<string, unknown>;
      },
      async listFiles(limit) {
        const { data, error } = await db.rpc('account_purge_storage_batch', { p_limit: limit });
        if (error) throw error;
        return (data ?? []) as { bucket_id: string; name: string }[];
      },
      async removeFiles(bucket, names) {
        const { data, error } = await db.storage.from(bucket).remove(names);
        if (error) {
          // Counts only: file names carry user ids.
          console.error('[account-purge] storage remove failed', { bucket, count: names.length, error: error.message });
          return 0;
        }
        return data?.length ?? 0;
      },
      async markCleared() {
        const { data, error } = await db.rpc('mark_account_storage_cleared');
        if (error) throw error;
        return (data ?? 0) as number;
      },
    });
    console.log('[account-purge]', JSON.stringify(summary));
    return successResponse(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[account-purge] failed:', msg);
    return errorResponse('Account purge failed', 500);
  }
});
