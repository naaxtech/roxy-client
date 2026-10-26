import { supabase } from './supabase';
import { logError } from './errorLogger';

export type RoxyNotification = {
  id: string;
  type:
    | 'friend_request' | 'friend_accept' | 'community_event' | 'message' | 'channel_message'
    // Migration 134: a decision on her application.
    | 'application_decided'
    // Migration 135: CHAT-09 invites and join requests.
    | 'community_invite' | 'community_join_request'
    // Migration 133: the creator loop and Archive decisions.
    | 'post_reaction' | 'comment' | 'follow' | 'archive_revision';
  title: string;
  body: string | null;
  link_path: string | null;
  created_at: string;
  read_at: string | null;
  /**
   * Migration 137: when she cleared it. A cleared notification is archived,
   * never deleted, so the duplicate checks that read past rows keep working.
   */
  archived_at: string | null;
};

/** A list read that tells a failed load apart from an empty one. */
export type NotificationsResult =
  | { ok: true; items: RoxyNotification[] }
  | { ok: false };

const COLUMNS = 'id, type, title, body, link_path, created_at, read_at, archived_at';
const PAGE = 50;

/**
 * Her inbox: the latest 50 notifications she has not cleared. `ok: false` on
 * any failure, so the screen can show an error with Retry instead of an empty
 * inbox it cannot vouch for.
 */
export async function fetchNotificationsResult(userId: string): Promise<NotificationsResult> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select(COLUMNS)
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(PAGE);
    if (error || !data) {
      if (error) logError(error, 'notifications.fetch');
      return { ok: false };
    }
    return { ok: true, items: data as RoxyNotification[] };
  } catch (e) {
    logError(e, 'notifications.fetch');
    return { ok: false };
  }
}

/**
 * Latest 50 notifications for the user (not cleared). Returns [] on any
 * failure so screens render an empty state on projects where migration 057
 * isn't applied yet.
 *
 * Kept, not deleted: the notifications screen moved to
 * `fetchNotificationsResult` (it needs to tell a failure from an empty inbox),
 * and this signature is the one any caller that only wants rows depends on.
 */
export async function fetchNotifications(userId: string): Promise<RoxyNotification[]> {
  const result = await fetchNotificationsResult(userId);
  return result.ok ? result.items : [];
}

/** What she cleared, most recently cleared first, 50 at most. */
export async function fetchArchivedNotifications(userId: string): Promise<NotificationsResult> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select(COLUMNS)
      .eq('user_id', userId)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(PAGE);
    if (error || !data) {
      if (error) logError(error, 'notifications.fetchArchived');
      return { ok: false };
    }
    return { ok: true, items: data as RoxyNotification[] };
  } catch (e) {
    logError(e, 'notifications.fetchArchived');
    return { ok: false };
  }
}

/** A row the archive RPC cleared, and whether it was unread when it was. */
export type ClearedNotification = { id: string; wasUnread: boolean };

/**
 * A clear's answer. `cleared` can be empty and still `ok`: zero rows means the
 * row was already gone (a cancelled request, an un-react deletes it) or already
 * archived. Only an RPC error is a failure.
 */
export type ClearResult =
  | { ok: true; cleared: ClearedNotification[] }
  | { ok: false };

/**
 * Clear all's answer, gathered over as many calls as it took. `more`: it
 * stopped at `CLEAR_ALL_MAX_CALLS` full calls, so older ones may remain.
 * `ok: false` keeps `cleared`: each call commits on its own, so the rows the
 * calls before the failure archived stay archived, and Undo restores exactly
 * those.
 */
export type ClearAllResult =
  | { ok: true; cleared: ClearedNotification[]; more: boolean }
  | { ok: false; cleared: ClearedNotification[] };

/**
 * A restore's answer: how many rows came back. Short means some were deleted
 * meanwhile. On a failure part-way, `restored` counts the calls that landed
 * and `unrestored` are the ids still archived, for a Retry of just those.
 */
export type RestoreResult =
  | { ok: true; restored: number }
  | { ok: false; restored: number; unrestored: string[] };

/**
 * Rows per archive call (the server's LIMIT for Clear all) and ids per
 * unarchive call (the server refuses more). Migration 137.
 */
export const ARCHIVE_BATCH = 500;

/** Clear all stops after this many full calls (20,000 rows) and says some may remain. */
export const CLEAR_ALL_MAX_CALLS = 40;

type ArchiveArgs = { p_ids: string[] } | { p_up_to: string };

function clearedRows(data: unknown): ClearedNotification[] | null {
  if (!Array.isArray(data)) return null;
  return data
    .filter((r): r is { id: string; was_unread?: unknown } =>
      typeof r === 'object' && r !== null && typeof (r as { id?: unknown }).id === 'string')
    .map((r) => ({ id: r.id, wasUnread: r.was_unread === true }));
}

/**
 * Migration 137's `archive_notifications`: one atomic update that sets
 * `archived_at` and `read_at = COALESCE(read_at, now())`, returning each row it
 * touched with `was_unread`. supabase-js resolves `{ data, error }` and does
 * not throw on an HTTP error, so `error` is the failure signal.
 * src: https://supabase.com/docs/reference/javascript/rpc · @supabase/supabase-js 2.105.4 · 2026-10-26
 */
async function archiveRpc(args: ArchiveArgs, scope: string): Promise<ClearResult> {
  try {
    const { data, error } = await supabase.rpc('archive_notifications', args);
    if (error) {
      logError(error, scope);
      return { ok: false };
    }
    const cleared = clearedRows(data);
    if (!cleared) {
      logError(new Error('archive_notifications returned no row list'), scope);
      return { ok: false };
    }
    return { ok: true, cleared };
  } catch (e) {
    logError(e, scope);
    return { ok: false };
  }
}

/** Clear these notifications (archive them, mark them read). The ids go in the RPC body. */
export async function clearNotifications(ids: string[]): Promise<ClearResult> {
  if (ids.length === 0) return { ok: true, cleared: [] };
  return archiveRpc({ p_ids: ids }, 'notifications.clear');
}

/**
 * Clear all: every un-archived notification of hers created at or before
 * `upTo` — the newest one on her screen — so one that arrived after the screen
 * loaded is not archived unseen. The server archives `ARCHIVE_BATCH` a call,
 * newest first, so this calls again with the same `upTo` until a call comes
 * back short, and gathers every id for Undo.
 */
export async function clearNotificationsUpTo(upTo: string): Promise<ClearAllResult> {
  const cleared: ClearedNotification[] = [];
  for (let call = 0; call < CLEAR_ALL_MAX_CALLS; call += 1) {
    const batch = await archiveRpc({ p_up_to: upTo }, 'notifications.clearAll');
    if (!batch.ok) return { ok: false, cleared };
    cleared.push(...batch.cleared);
    if (batch.cleared.length < ARCHIVE_BATCH) return { ok: true, cleared, more: false };
  }
  return { ok: true, cleared, more: true };
}

/** One `unarchive_notifications` call: the count it restored, or null on a failure. */
async function unarchiveRpc(ids: string[], markUnread: string[]): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('unarchive_notifications', {
      p_ids: ids,
      p_mark_unread: markUnread,
    });
    if (error) {
      logError(error, 'notifications.restore');
      return null;
    }
    if (typeof data !== 'number') {
      logError(new Error('unarchive_notifications returned no count'), 'notifications.restore');
      return null;
    }
    return data;
  } catch (e) {
    logError(e, 'notifications.restore');
    return null;
  }
}

/**
 * Undo or Restore: back into the inbox, `ARCHIVE_BATCH` ids a call.
 * `markUnread` (kept a subset of each call's ids) are the rows that were unread
 * when cleared; they come back unread, so the bell counts them again. The count
 * is how many came back — rows deleted meanwhile are not counted, and that is
 * not an error. A failed call stops the run: the calls before it stand.
 */
export async function restoreNotifications(
  ids: string[],
  markUnread: string[] = [],
): Promise<RestoreResult> {
  const unread = new Set(markUnread);
  let restored = 0;
  for (let start = 0; start < ids.length; start += ARCHIVE_BATCH) {
    const chunk = ids.slice(start, start + ARCHIVE_BATCH);
    const count = await unarchiveRpc(chunk, chunk.filter((id) => unread.has(id)));
    if (count === null) return { ok: false, restored, unrestored: ids.slice(start) };
    restored += count;
  }
  return { ok: true, restored };
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  } catch {
    // non-fatal — the row stays unread and can be retried on next open
  }
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  try {
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
  } catch {
    // non-fatal
  }
}

export function countUnread(list: RoxyNotification[]): number {
  return list.filter((n) => n.read_at === null).length;
}

/**
 * Unread count only — a head request transfers a single integer instead of
 * full rows, which is all the bell badge needs. A cleared (archived) row is
 * never counted. Returns 0 on failure.
 */
export async function fetchUnreadNotificationCount(userId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null)
      .is('archived_at', null);
    if (error || count === null) return 0;
    return count;
  } catch {
    return 0;
  }
}
