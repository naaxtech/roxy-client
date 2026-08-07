import { supabase } from './supabase';
import { logError } from './errorLogger';

/**
 * Badge awarding is server-side and only PARTLY automatic.
 *
 * Migration 087 wires exactly one trigger — `trg_badges_on_community_join` —
 * and it passes `p_requirement_type = 'community_joins'`, which filters the
 * catalogue loop to that one type. The other three requirement_types in the
 * catalogue (`connections`, `messages`, `speed_dates`, all threshold 1 since
 * migration 007) have no writer at all. Without a client calling
 * `sync_my_badges()` they can never be earned: a member who makes her first
 * friend, sends her first message and completes her first speed date earns
 * nothing, while members who existed at the 087 backfill keep theirs.
 *
 * `sync_my_badges()` is parameterless by design — identity is `auth.uid()` and
 * every count is derived server-side from the source tables, so there is no
 * field in the call a client could falsify. It returns how many badges were
 * newly earned.
 */

/**
 * Floor between two unforced syncs of the same member.
 *
 * The RPC walks the whole badge catalogue for the caller — four rows today,
 * each a single index probe bounded by `LIMIT requirement_threshold` — so it is
 * cheap but not free, and the surfaces that call it (a tab root's focus effect)
 * fire on every tab switch. Five minutes is short enough that a member who
 * earns a badge and comes back to Grow in the same sitting sees it, and long
 * enough that hopping between tabs cannot turn it into a request per second.
 *
 * An explicit visit to the Badges screen passes `force` and ignores this — that
 * is a deliberate "show me where I am", and its rate is bounded by how fast a
 * human can navigate.
 */
export const BADGE_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;

export type BadgeSyncResult =
  /** The RPC ran. `newlyEarned` badges crossed their threshold just now. */
  | { status: 'synced'; newlyEarned: number }
  /** Throttled, or nobody is signed in. Nothing was asked of the server. */
  | { status: 'skipped' }
  /** The RPC was attempted and did not complete. Already logged. */
  | { status: 'failed' };

/**
 * Keyed by member id, not global: signing out and back in as someone else must
 * not inherit the previous account's throttle and skip her first sync.
 */
let lastSync: { memberId: string; at: number } | null = null;

/**
 * Recompute the signed-in member's badge progress server-side and award
 * anything now earned.
 *
 * Never throws and never rejects — a gamification failure must not be able to
 * stop a screen rendering, so callers can fire this and read the result at
 * their leisure. Failures are reported to the caller AND logged, never
 * swallowed silently.
 *
 * @param memberId  The signed-in member, used only to key the throttle. The
 *                  server takes its identity from the JWT, never from here.
 */
export async function syncMyBadges(
  memberId: string | undefined,
  options?: { force?: boolean },
): Promise<BadgeSyncResult> {
  if (!memberId) return { status: 'skipped' };

  const now = Date.now();
  if (
    !options?.force &&
    lastSync !== null &&
    lastSync.memberId === memberId &&
    now - lastSync.at < BADGE_SYNC_MIN_INTERVAL_MS
  ) {
    return { status: 'skipped' };
  }

  // Stamped before the call, not after: a sync that fails because the device is
  // offline must not be retried on the next focus event either. The floor is a
  // rate limit on attempts, not on successes.
  lastSync = { memberId, at: now };

  try {
    const { data, error } = await supabase.rpc('sync_my_badges');
    if (error) {
      // `error` is a PostgrestError, not an Error — String() on it yields
      // "[object Object]", so build the message here. Nothing user-identifying
      // rides along: this is an RPC status, not member data.
      logError(new Error(`sync_my_badges failed: ${error.message}`), 'badges.sync');
      return { status: 'failed' };
    }
    return { status: 'synced', newlyEarned: typeof data === 'number' ? data : 0 };
  } catch (e) {
    logError(e, 'badges.sync');
    return { status: 'failed' };
  }
}
