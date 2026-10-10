import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { normalizePost } from './posts';
import { POST_WITH_AUTHOR_AND_COMMUNITY } from './supabaseQueries';
import type { ReelRow } from './reels';

/**
 * The public square.
 *
 * For You ranks profile-wall posts — `author_id`, never a community folder.
 * Follow is a bonus, not a filter: a new account with nobody followed still
 * sees the square. `posts_select` remains the read lock; the client filter
 * here only drops deleted rows between the two round trips.
 *
 * Ranking comes from `feed_rank_page` (migration 133). It replaced
 * `announcement_feed` (073, 118) as the client's call because that RPC
 * ordered by rank but paged by "older than the oldest post on the page", which
 * skipped every newer post ranked below a high-scoring old one (FEED-02).
 * `announcement_feed` stays in the database for installed builds, and this
 * module falls back to it only when 133 is not deployed yet.
 */

/**
 * Both RPCs clamp their own limit — `LIMIT LEAST(GREATEST(p_limit,1),50)` —
 * so asking for more than this silently returns 50 and a `hasMore` computed
 * against the requested number would always read false.
 */
export const ANNOUNCEMENT_PAGE_SIZE = 50;

/** One ranked row. `as_of` is set by `feed_rank_page` only. */
export type AnnouncementRankRow = {
  post_id: string;
  community_id: string;
  rank: number;
  created_at: string;
  as_of?: string;
};

/**
 * Where the next For You page starts.
 *
 * `keyset` is the real cursor: the last row's (rank, created_at, id) plus the
 * clock the first page was ranked at. Rank decays with time, so ranking page 2
 * at a later `now()` would reshuffle rows across the boundary.
 *
 * `legacy` exists only for the fallback to `announcement_feed` while 133 is
 * not deployed.
 */
export type ForYouCursor =
  | { kind: 'keyset'; asOf: string; rank: number; createdAt: string; id: string }
  | { kind: 'legacy'; before: string };

export type AnnouncementPage = {
  /** Full post rows, in the RPC's rank order. */
  rows: ReelRow[];
  /**
   * Cursor for the next page. Taken from the RAW ranked page before any
   * post-type filter, so paging past a page that held no video does not
   * re-serve the same posts forever.
   */
  cursor: ForYouCursor | null;
  hasMore: boolean;
};

export type FetchAnnouncementPageOptions = {
  limit?: number;
  /** `page.cursor` from the previous call; null or absent for the first page. */
  cursor?: ForYouCursor | null;
  /** Reels wants only the video announcements; the card feed wants all of them. */
  videoOnly?: boolean;
};

/**
 * PostgREST answers PGRST202 when it has no such function in its schema
 * cache; Postgres itself says 42883. Either means "133 is not deployed here".
 * Any other error is real and is passed through.
 */
function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

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
      ...(typeof row.as_of === 'string' ? { as_of: row.as_of } : {}),
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
 * The keyset cursor after a ranked page: its LAST row, which is the lowest
 * (rank, created_at, id) the server returned. Ties on rank are told apart by
 * created_at and then id, the same order `feed_rank_page` sorts by.
 *
 * Null when the page has no row or the server sent no clock (`as_of`), which
 * only `announcement_feed` does.
 */
export function nextForYouCursor(ranked: AnnouncementRankRow[]): ForYouCursor | null {
  const last = ranked[ranked.length - 1];
  if (!last?.as_of) return null;
  return {
    kind: 'keyset', asOf: last.as_of, rank: last.rank, createdAt: last.created_at, id: last.post_id,
  };
}

/**
 * The oldest `created_at` in a ranked page — the legacy `p_before`.
 *
 * Only for the `announcement_feed` fallback. Not simply the last row: that
 * page is ordered by rank, not by time, so the last row is rarely the oldest.
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

/** The legacy RPC, for a database without 133. */
async function rankLegacy(
  limit: number,
  before: string | null,
): Promise<{ ranked: AnnouncementRankRow[]; cursor: ForYouCursor | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('announcement_feed', { p_limit: limit, p_before: before });
  if (error) return { ranked: [], cursor: null, error };
  const ranked = toRankRows(data);
  const oldest = oldestCreatedAt(ranked);
  return { ranked, cursor: oldest ? { kind: 'legacy', before: oldest } : null, error: null };
}

/**
 * One page of For You: rank the ids, then hydrate them.
 *
 * Two round trips rather than one because the RPC returns ids, and the cards
 * need the author and community embeds every other post surface in the app
 * already uses (`POST_WITH_AUTHOR_AND_COMMUNITY`).
 *
 * Every post type, not only video. The Feed tab calls this for For You; do not
 * point it at `fetchAnnouncementVideos`.
 */
export async function fetchAnnouncementPage(
  options: FetchAnnouncementPageOptions = {},
): Promise<{ page: AnnouncementPage | null; error: PostgrestError | null }> {
  const limit = Math.min(Math.max(options.limit ?? ANNOUNCEMENT_PAGE_SIZE, 1), ANNOUNCEMENT_PAGE_SIZE);
  const cursor = options.cursor ?? null;

  let ranked: AnnouncementRankRow[];
  let next: ForYouCursor | null;

  if (cursor?.kind === 'legacy') {
    const legacy = await rankLegacy(limit, cursor.before);
    if (legacy.error) return { page: null, error: legacy.error };
    ranked = legacy.ranked;
    next = legacy.cursor;
  } else {
    const { data: rankData, error: rankError } = await supabase.rpc('feed_rank_page', {
      p_limit: limit,
      p_as_of: cursor?.asOf ?? null,
      p_cursor_rank: cursor?.rank ?? null,
      p_cursor_created_at: cursor?.createdAt ?? null,
      p_cursor_id: cursor?.id ?? null,
    });
    if (rankError && isMissingFunction(rankError) && cursor === null) {
      const legacy = await rankLegacy(limit, null);
      if (legacy.error) return { page: null, error: legacy.error };
      ranked = legacy.ranked;
      next = legacy.cursor;
    } else if (rankError) {
      return { page: null, error: rankError };
    } else {
      ranked = toRankRows(rankData);
      next = nextForYouCursor(ranked);
    }
  }

  const hasMore = ranked.length === limit && next !== null;
  if (ranked.length === 0) {
    return { page: { rows: [], cursor: null, hasMore: false }, error: null };
  }

  let hydrate = supabase
    .from('posts')
    .select(POST_WITH_AUTHOR_AND_COMMUNITY)
    .in('id', ranked.map((row) => row.post_id))
    // Belt and braces with the RPC's own predicate: if a post is deleted or
    // demoted between the two round trips, it must not reach the screen.
    .is('community_id', null)
    .is('deleted_at', null);
  if (options.videoOnly) hydrate = hydrate.eq('post_type', 'video');

  const { data, error } = await hydrate;
  if (error) return { page: null, error };

  return {
    page: { rows: orderByRank(toReelRows(data), ranked), cursor: next, hasMore },
    error: null,
  };
}

/** How many ranked pages a video search will walk before giving up. */
const MAX_VIDEO_PAGES = 3;

/**
 * A page of *video* from the For You ranking.
 *
 * KEPT ON PURPOSE — currently has no callers. Do not delete without asking.
 *
 * History: added in 9f98005 (2026-08-05) when the old Connect tab had a
 * separate Reels sub-tab that played only video announcements; `ReelsFeed`
 * called it for `scope="announcements"`. In the Roxy 3.0 revamp the Feed tab
 * became a TikTok-style pager that carries EVERY post type (video, photo,
 * text card, poll, resource — see docs/handoff/roxy-3.0/README.md "Feed (3
 * renderers)"), so on 2026-10-04 `ReelsFeed` switched For You to
 * `fetchAnnouncementPage` (all types). Calling this from the Feed tab again
 * would hide every text and photo post from For You — on production that was
 * 33 of 41 posts.
 *
 * Use it only for a deliberately video-only surface (e.g. a future "Videos"
 * filter or a reels-only view), never for the main feed.
 *
 * A ranked page of 50 posts can easily contain no video at all — most walls
 * start as text and photos — and a reels tab that renders "no videos yet"
 * while the RPC still has pages left is lying about an empty library. So keep
 * walking the cursor until a page yields video, the stream runs out, or the
 * walk hits `MAX_VIDEO_PAGES`.
 */
export async function fetchAnnouncementVideos(
  start: ForYouCursor | null = null,
): Promise<{ page: AnnouncementPage | null; error: PostgrestError | null }> {
  let cursor = start;
  let hasMore = true;

  for (let attempt = 0; attempt < MAX_VIDEO_PAGES; attempt += 1) {
    const { page, error } = await fetchAnnouncementPage({ cursor, videoOnly: true });
    if (error || !page) return { page: null, error };
    cursor = page.cursor;
    hasMore = page.hasMore;
    if (page.rows.length > 0 || !page.hasMore) {
      return { page: { rows: page.rows, cursor, hasMore: page.hasMore }, error: null };
    }
  }

  return { page: { rows: [], cursor, hasMore }, error: null };
}
