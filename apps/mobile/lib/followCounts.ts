import { supabase } from './supabase';
import { logError } from './errorLogger';

export type FollowCounts = { followers: number; following: number; followsYou: boolean };

/**
 * Follower / following counts and whether she follows the viewer.
 *
 * `follows_select_own` (116) only shows rows that involve the caller, so the
 * counts come from `follow_counts()` (133 §9c), which withholds them across a
 * block and from unapproved callers (zero rows -> null here). Null means
 * "do not show numbers", never "zero followers".
 */
export async function fetchFollowCounts(userId: string): Promise<FollowCounts | null> {
  const { data, error } = await supabase.rpc('follow_counts', { p_user_id: userId });
  if (error) {
    logError(error, 'followCounts.fetch');
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { followers: number | string; following: number | string; follows_you: boolean }
    | undefined;
  if (!row) return null;
  return {
    followers: Number(row.followers) || 0,
    following: Number(row.following) || 0,
    followsYou: !!row.follows_you,
  };
}

/** 1234 -> "1.2k" — the header has room for four characters. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
