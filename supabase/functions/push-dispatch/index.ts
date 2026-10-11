import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { dispatchOnce, type DispatchDeps, pairKey, type RowUpdate } from '../_shared/pushDispatch.ts';
import { chunk, type ExpoMessage, type ExpoTicket } from '../_shared/pushCore.ts';
import { isServiceRequest } from '../_shared/serviceAuth.ts';

/**
 * push-dispatch — drains push_outbox (migration 129) to Expo Push.
 *
 * Callers: the push_outbox insert trigger (pg_net, instant) and a pg_cron sweep
 * every minute (retries and anything the instant wake missed). Both send the
 * service-role key; there is no user involved, so `verify_jwt = false` in
 * config.toml and the key is compared here before any work is done.
 *
 * All decisions are in _shared/pushDispatch.ts and _shared/pushCore.ts (tested).
 * This file is only I/O. EXPO_ACCESS_TOKEN is optional: send it only if "enhanced
 * push security" is switched on in the Expo dashboard.
 */

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';

function expoHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // Shared check (was a local copy): exact `Bearer <service key>`, constant time, empty env => reject.
  if (!isServiceRequest(req)) return errorResponse('Unauthorized', 401);

  const db = getSupabaseClient();

  const deps: DispatchDeps = {
    async claim(limit) {
      const { data, error } = await db.rpc('claim_push_batch', { p_limit: limit });
      if (error) throw error;
      return data ?? [];
    },
    async notifications(ids) {
      const { data, error } = await db.from('notifications')
        .select('id, user_id, actor_id, type, title, body, link_path, read_at').in('id', ids);
      if (error) throw error;
      return data ?? [];
    },
    async devices(userIds) {
      const { data, error } = await db.from('push_devices')
        .select('user_id, token').in('user_id', userIds).eq('enabled', true);
      if (error) throw error;
      return data ?? [];
    },
    async settings(userIds) {
      const { data, error } = await db.from('notification_settings')
        // Every column: preference columns arrive with later migrations
        // (membership in 134), and naming one before it exists fails the whole
        // batch. A column she has never set is absent, which means ON.
        .select('*')
        .in('user_id', userIds);
      if (error) throw error;
      return data ?? [];
    },
    async mutedPairs(pairs) {
      const set = new Set<string>();
      const users = [...new Set(pairs.map((p) => p.user_id))];
      if (!users.length) return set;
      const { data, error } = await db.from('mutes').select('user_id, muted_user_id').in('user_id', users);
      if (error) throw error;
      for (const m of data ?? []) set.add(pairKey(m.user_id, m.muted_user_id));
      return set;
    },
    async blockedPairs(pairs) {
      const set = new Set<string>();
      const users = [...new Set(pairs.map((p) => p.user_id))];
      if (!users.length) return set;
      // friendships.status = 'blocked' is the block record (085); either direction blocks.
      const list = users.join(',');
      const { data, error } = await db.from('friendships')
        .select('requester_id, addressee_id').eq('status', 'blocked')
        .or(`requester_id.in.(${list}),addressee_id.in.(${list})`);
      if (error) throw error;
      for (const f of data ?? []) {
        set.add(pairKey(f.requester_id, f.addressee_id));
        set.add(pairKey(f.addressee_id, f.requester_id));
      }
      return set;
    },
    async actorNames(actorIds) {
      const map = new Map<string, string>();
      if (!actorIds.length) return map;
      const { data, error } = await db.from('profiles').select('id, display_name').in('id', actorIds);
      if (error) throw error;
      for (const p of data ?? []) if (p.display_name) map.set(p.id, p.display_name);
      return map;
    },
    async sendToExpo(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
      const res = await fetch(EXPO_SEND, { method: 'POST', headers: expoHeaders(), body: JSON.stringify(messages) });
      if (res.status === 429 || res.status >= 500) throw new Error(`Expo ${res.status}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Expo ${res.status}: ${JSON.stringify(json?.errors ?? json).slice(0, 200)}`);
      return Array.isArray(json?.data) ? json.data : [];
    },
    async update(rows: RowUpdate[]) {
      // One statement per row keeps each row's own fields; volumes per run are
      // bounded by the claim limit.
      for (const r of rows) {
        const { id, ...fields } = r;
        const { error } = await db.from('push_outbox').update({ ...fields, locked_at: null }).eq('id', id);
        if (error) console.error('push_outbox update failed', id, error.message);
      }
    },
    async disableTokens(tokens, reason) {
      const { error } = await db.from('push_devices').update({ enabled: false, last_error: reason }).in('token', tokens);
      if (error) console.error('disable tokens failed', error.message);
    },
    now: () => new Date(),
  };

  try {
    const summary = await dispatchOnce(deps, 500);
    const receipts = await checkReceipts(db);
    // Counts only: never log tokens, names or message text.
    console.log(JSON.stringify({ push_dispatch: summary, receipts }));
    return successResponse({ ...summary, receipts });
  } catch (e) {
    console.error('push-dispatch failed', e instanceof Error ? e.message : String(e));
    return errorResponse('dispatch failed', 500);
  }
});

/**
 * Expo's tickets only say "accepted"; the receipt says whether Apple/Google
 * delivered. Checked 15+ minutes after sending, as Expo recommends. A
 * DeviceNotRegistered receipt disables the token so the next push skips it.
 */
async function checkReceipts(db: ReturnType<typeof getSupabaseClient>) {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: rows, error } = await db.from('push_outbox')
    .select('id, ticket_ids, user_id').eq('status', 'sent').is('receipts_checked_at', null)
    .lt('sent_at', cutoff).limit(300);
  if (error || !rows?.length) return { checked: 0, dead: 0 };

  const ids = rows.flatMap((r) => r.ticket_ids ?? []);
  const errorsById = new Map<string, string>();
  for (const batch of chunk(ids, 1000)) {
    const res = await fetch(EXPO_RECEIPTS, { method: 'POST', headers: expoHeaders(), body: JSON.stringify({ ids: batch }) });
    if (!res.ok) return { checked: 0, dead: 0 };
    const json = await res.json().catch(() => ({}));
    for (const [id, r] of Object.entries((json?.data ?? {}) as Record<string, ExpoTicket>)) {
      if (r.status === 'error') errorsById.set(id, r.details?.error ?? 'error');
    }
  }

  let dead = 0;
  for (const r of rows) {
    const errs = (r.ticket_ids ?? []).map((t: string) => errorsById.get(t)).filter(Boolean) as string[];
    if (errs.includes('DeviceNotRegistered')) dead++;
    await db.from('push_outbox').update({
      receipts_checked_at: new Date().toISOString(),
      last_error: errs.length ? errs.join(',').slice(0, 300) : null,
    }).eq('id', r.id);
  }
  // A receipt does not say which token died, only which ticket; the next send to
  // that device returns DeviceNotRegistered on the ticket itself and the
  // dispatcher disables it there.
  return { checked: rows.length, dead };
}
