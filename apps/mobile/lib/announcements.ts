import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { normalizePost } from './posts';
import { POST_WITH_AUTHOR_AND_COMMUNITY } from './supabaseQueries';
import type { ReelRow } from './reels';

/**
 * The public square.
 *
 * Connect shows community *announcements* — a post published under a
 * community's own name, capped at one per community per UTC day by
 * `uq_community_announcement_per_day` (migration 073). Member conversation
 * lives inside each community and requires joining; this module never returns
 * it. `announcement_feed` is SECURITY INVOKER, so `posts_select` still decides
 * what the caller may read — the client filter here is the second lock, not
 * the only one.
 *
 * The discovery half matters as much as the filtering half: the RPC ranks
 * across EVERY community, joined or not (membership is worth +2 on the rank,
 * not a WHERE clause), which is what gives a brand-new account with zero
 * communities a populated first screen.
 */

/**
 * `announcement_feed` clamps its own limit — `LIMIT LEAST(GREATEST(p_limit,1),50)`
 * — so asking for more than this silently returns 50 and a `hasMore` computed
 * against the requested number would always read false.
 */
export const ANNOUNCEMENT_PAGE_SIZE = 50;

/** One row of `public.announcement_feed(p_limit int, p_before timestamptz)`. */
export type AnnouncementRankRow = {
  post_id: string;
  community_id: string;
  rank: number;
  created_at: string;
};

export type AnnouncementPage = {
  /** Full post rows, in the RPC's rank order. */
  rows: ReelRow[];
  /**
   * Cursor for the next page — pass as `before`. Taken from the RAW ranked page
   * before any post-type filter, so paging past a page that held no video does
   * not re-serve the same announcements forever.
   */
  before: string | null;
  hasMore: boolean;
};

export type FetchAnnouncementPageOptions = {
  limit?: number;
  /** `created_at` of the oldest row already held. */
  before?: string | null;
  /** Reels wants only the video announcements; the card feed wants all of them. */
  videoOnly?: boolean;
};

/**
 * The client is created without a generated `Database` type, so `rpc()` hands
 * back `any`. Narrow it here rather than casting at the call site: a shape
 * check is the only thing standing between a changed RPC signature and a screen
 * full of `undefined`.
 */
export function toRankRows(data: unknown): AnnouncementRankRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry): AnnouncementRankRow[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.post_id !== 'string' || typeof row.created_at !== 'string') return [];
    return [{
      post_id: row.post_id,
      community_id: typeof row.community_id === 'string' ? row.community_id : '',
      rank: typeof row.rank === 'number' ? row.rank : 0,
      created_at: row.created_at,
    }];
  });
}

/**
 * Restore the RPC's ranking after hydrating the rows.
 *
 * `in('id', ids)` returns rows in whatever order Postgres finds them, which
 * throws away the interest-overlap ranking the RPC just computed. Rows that
 * were filtered out of the hydrate query (a non-video post when reels asked for
 * video) simply drop out.
 */
export function orderByRank<T extends { id: string }>(
  rows: T[],
  ranked: AnnouncementRankRow[],
): T[] {
  if (!rows.length) return [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ranked.flatMap((entry) => {
    const row = byId.get(entry.post_id);
    return row ? [row] : [];
  });
}

/**
 * The oldest `created_at` in a ranked page — the next page's `p_before`.
 *
 * Not simply the last row: the page is ordered by rank, not by time, so the
 * last row is rarely the oldest one.
 */
export function oldestCreatedAt(ranked: AnnouncementRankRow[]): string | null {
  let oldest: string | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const row of ranked) {
    const ms = Date.parse(row.created_at);
    if (Number.isNaN(ms) || ms >= oldestMs) continue;
    oldestMs = ms;
    oldest = row.created_at;
  }
  return oldest;
}

function toReelRows(data: unknown[] | null | undefined): ReelRow[] {
  return (data ?? []).map((row) => {
    const raw = row as Record<string, unknown> & { communities?: { name: string } | null };
    return { ...normalizePost(raw), communities: raw.communities ?? null };
  });
}

/**
 * One page of the announcement feed: rank the ids, then hydrate them.
 *
 * Two round trips rather than one because the RPC returns ids, and the cards
 * need the author and community embeds every other post surface in the app
 * already uses (`POST_WITH_AUTHOR_AND_COMMUNITY`). Widening the RPC's return
 * type would mean editing an applied migration.
 */
export async function fetchAnnouncementPage(
  options: FetchAnnouncementPageOptions = {},
): Promise<{ page: AnnouncementPage | null; error: PostgrestError | null }> {
  const limit = Math.min(Math.max(options.limit ?? ANNOUNCEMENT_PAGE_SIZE, 1), ANNOUNCEMENT_PAGE_SIZE);

  const { data: rankData, error: rankError } = await supabase.rpc('announcement_feed', {
    p_limit: limit,
    p_before: options.before ?? null,
  });
  if (rankError) return { page: null, error: rankError };

  const ranked = toRankRows(rankData);
  const before = oldestCreatedAt(ranked);
  const hasMore = ranked.length === limit;
  if (ranked.length === 0) {
    return { page: { rows: [], before: null, hasMore: false }, error: null };
  }

  let hydrate = supabase
    .from('posts')
    .select(POST_WITH_AUTHOR_AND_COMMUNITY)
    .in('id', ranked.map((row) => row.post_id))
    // Belt and braces with the RPC's own predicate: if a post is deleted or
    // demoted between the two round trips, it must not reach the screen.
    .eq('posted_as_community', true)
    .is('deleted_at', null);
  if (options.videoOnly) hydrate = hydrate.eq('post_type', 'video');

  const { data, error } = await hydrate;
  if (error) return { page: null, error };

  return {
    page: { rows: orderByRank(toReelRows(data), ranked), before, hasMore },
    error: null,
  };
}

/** How many ranked pages a video search will walk before giving up. */
const MAX_VIDEO_PAGES = 3;

/**
 * A page of *video* announcements.
 *
 * A ranked page of 50 announcements can easily contain no video at all — most
 * communities announce in text — and a reels tab that renders "no videos yet"
 * while the RPC still has pages left is lying about an empty library. So keep
 * walking the cursor until a page yields video, the stream runs out, or the
 * walk hits `MAX_VIDEO_PAGES` (which bounds the worst case at three round trips
 * rather than one per community-day in the table).
 */
export async function fetchAnnouncementVideos(
  before: string | null = null,
): Promise<{ page: AnnouncementPage | null; error: PostgrestError | null }> {
  let cursor = before;
  let hasMore = true;

  for (let attempt = 0; attempt < MAX_VIDEO_PAGES; attempt += 1) {
    const { page, error } = await fetchAnnouncementPage({ before: cursor, videoOnly: true });
    if (error || !page) return { page: null, error };
    cursor = page.before;
    hasMore = page.hasMore;
    if (page.rows.length > 0 || !page.hasMore) {
      return { page: { rows: page.rows, before: cursor, hasMore: page.hasMore }, error: null };
    }
  }

  return { page: { rows: [], before: cursor, hasMore }, error: null };
}
