import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { normalizePost } from './posts';
import { POST_WITH_AUTHOR_AND_COMMUNITY } from './supabaseQueries';
import { orderByRank } from './announcements';
import type { ReelRow } from './reels';

/**
 * One page of a wall feed: Following (the people she follows) or a community
 * (its official owner's wall).
 *
 * Ranking and paging come from `wall_feed_page` (migration 133), which pages
 * on (feed_score, created_at, id). The query it replaced paged on
 * `feed_score < last score`, which skipped every post tied with the last one
 * on the page (FEED-02).
 *
 * The RPC also drops posts she hid and, unless `skipMuted` is false, authors
 * she muted. `skipMuted` is false only where she opened that person's profile
 * on purpose.
 */

export type WallCursor = { score: number; createdAt: string; id: string };

export type WallRankRow = { post_id: string; feed_score: number; created_at: string };

export type WallPage = { rows: ReelRow[]; cursor: WallCursor | null; hasMore: boolean };

export type FetchWallPageOptions = {
  authorIds: string[];
  limit: number;
  cursor: WallCursor | null;
  skipMuted: boolean;
};

function toWallRows(data: unknown): WallRankRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry): WallRankRow[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.post_id !== 'string' || typeof row.created_at !== 'string') return [];
    return [{
      post_id: row.post_id,
      feed_score: typeof row.feed_score === 'number' ? row.feed_score : 0,
      created_at: row.created_at,
    }];
  });
}

/** The cursor after a page: its last row. */
export function nextWallCursor(rows: WallRankRow[]): WallCursor | null {
  const last = rows[rows.length - 1];
  return last ? { score: last.feed_score, createdAt: last.created_at, id: last.post_id } : null;
}

function toReelRows(data: unknown[] | null | undefined): ReelRow[] {
  return (data ?? []).map((row) => {
    const raw = row as Record<string, unknown> & { communities?: { name: string } | null };
    return { ...normalizePost(raw), communities: raw.communities ?? null };
  });
}

function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

export async function fetchWallPage(
  { authorIds, limit, cursor, skipMuted }: FetchWallPageOptions,
): Promise<{ page: WallPage | null; error: PostgrestError | null }> {
  if (!authorIds.length) return { page: { rows: [], cursor: null, hasMore: false }, error: null };

  const { data, error } = await supabase.rpc('wall_feed_page', {
    p_author_ids: authorIds,
    p_limit: limit,
    p_cursor_score: cursor?.score ?? null,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_skip_muted: skipMuted,
  });

  if (error && isMissingFunction(error) && cursor === null) {
    // 133 is not deployed here yet. One page from the plain query, and no
    // claim of a next page: the plain query cannot page without skipping.
    const legacy = await supabase
      .from('posts')
      .select(POST_WITH_AUTHOR_AND_COMMUNITY)
      .in('author_id', authorIds)
      .is('deleted_at', null)
      .order('feed_score', { ascending: false })
      .limit(limit);
    if (legacy.error) return { page: null, error: legacy.error };
    return { page: { rows: toReelRows(legacy.data), cursor: null, hasMore: false }, error: null };
  }
  if (error) return { page: null, error };

  const ranked = toWallRows(data);
  if (!ranked.length) return { page: { rows: [], cursor: null, hasMore: false }, error: null };

  const hydrated = await supabase
    .from('posts')
    .select(POST_WITH_AUTHOR_AND_COMMUNITY)
    .in('id', ranked.map((row) => row.post_id))
    .is('deleted_at', null);
  if (hydrated.error) return { page: null, error: hydrated.error };

  // orderByRank only needs post_id order; the wall rows carry it.
  const rows = orderByRank(
    toReelRows(hydrated.data),
    ranked.map((row) => ({ post_id: row.post_id, community_id: '', rank: row.feed_score, created_at: row.created_at })),
  );
  return {
    page: { rows, cursor: nextWallCursor(ranked), hasMore: ranked.length === limit },
    error: null,
  };
}
