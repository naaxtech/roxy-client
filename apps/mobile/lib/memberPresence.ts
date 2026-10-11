import { supabase } from './supabase';
import { logError } from './errorLogger';

/**
 * Presence without the timestamp.
 *
 * `profiles.last_seen_at` stopped being readable by other members in
 * migration 130 (PRO-01): an exact last-seen time tells a stalker when a woman
 * is awake, and the app only ever needed "online now, yes or no". The server
 * answers that through `member_presence(ids)`, for approved members only,
 * never for a blocked pair or a ghost.
 *
 * Existing consumers (`isOnline`, `sortByPresence`, `officialPresenceLine`)
 * read a `last_seen_at` string. `presenceStamp` keeps them working unchanged:
 * an online member gets the moment we asked, everyone else gets null. It is
 * a presence marker, not her real last-seen time, and must never be shown as
 * a time.
 */

const MAX_IDS = 200;

export async function fetchOnlineIds(userIds: readonly string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean))).slice(0, MAX_IDS);
  if (ids.length === 0) return new Set();
  try {
    const { data, error } = await supabase.rpc('member_presence', { p_user_ids: ids });
    if (error) throw error;
    return new Set(
      ((data ?? []) as { user_id: string; online: boolean }[])
        .filter((r) => r.online)
        .map((r) => r.user_id),
    );
  } catch (e) {
    // Presence is decoration. Failing to fetch it must never fail the screen.
    logError(e, 'member_presence');
    return new Set();
  }
}

export function presenceStamp(online: boolean, now: number = Date.now()): string | null {
  return online ? new Date(now).toISOString() : null;
}
