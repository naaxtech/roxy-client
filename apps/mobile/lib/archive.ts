import { supabase } from './supabase';
import { logBreadcrumb, logError } from './errorLogger';
import { ilikePattern } from './ilikePattern';

/**
 * The WLW Archive — scoring, and the queries behind it.
 *
 * One score, one question: rate it out of 5. The community average is
 * star_sum / vote_count. 4★ and 5★ still count as a recommend so the
 * existing up_count ranking keeps working. No critic score, no sub-scores.
 *
 * Every surface reads the score through `formatScore`. That is not a style
 * preference: the gate below is the only thing standing between the browse list
 * and a row that says 100% because one person liked it, and a second call site
 * doing its own division is how that rule gets lost.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · markup 952–1090, behaviour 1977–2032 · 2026-09-01
 */

/**
 * How many votes an entry needs before it can be RANKED.
 *
 * This used to gate display as well: under ten votes an entry showed no
 * percentage at all. That was changed deliberately — an entry one woman has
 * rated now shows her rating, because hiding it made a catalogue of 45 titles
 * look like a catalogue of none, and because a score with its sample size
 * printed beside it is information rather than a claim.
 *
 * It still gates RANKING. "Top rated" leading with a 100% built from a single
 * vote is a different problem from showing that 100% on the entry's own row:
 * one is the app making a recommendation, the other is the app reporting what
 * it has. Mirrored by `archive_entries.has_score` (migration 095), and
 * `__tests__/lib/archiveScore.test.ts` reads the threshold out of the migration
 * so the two cannot drift.
 */
export const SCORE_GATE = 10;

export type ArchiveMediaType = 'film' | 'tv' | 'book' | 'comic' | 'music';

export type ArchiveVerdict =
  | 'Community favourite'
  | 'Worth your night'
  | 'Divisive'
  | 'Most of us said skip it';

export type ArchiveScore = {
  /** Whether the entry has earned a number. */
  hasScore: boolean;
  /** 0–100 fill for the ring, or null when nobody has rated it. */
  percent: number | null;
  /** Community average out of 5, or null when we only have a recommend %. */
  average: number | null;
  /** What to render: "4.2" or "84%" or "Unreviewed". */
  label: string;
  /** The sentence under the ring, or null when nobody has rated it. */
  verdict: ArchiveVerdict | null;
  total: number;
};

/** A tap on the star row is always 1–5, even if a caller sends junk. */
export function clampStars(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.round(value)));
}

/** 4★ and 5★ still count as a recommend for the legacy up_count tally. */
export function starsToRecommend(stars: number): boolean {
  return clampStars(stars) >= 4;
}

/** A stored vote may be the old boolean, or the new 1–5. Both become stars. */
export function starsFromVoteRow(row: { stars?: number | null; value?: boolean }): number {
  if (typeof row.stars === 'number') return clampStars(row.stars);
  return row.value ? 5 : 2;
}

export function applyLocalStarVote<T extends {
  vote_count: number;
  up_count: number;
  star_sum?: number | null;
}>(entry: T, previousStars: number | undefined, nextStars: number): T {
  const next = clampStars(nextStars);
  const wasNew = previousStars == null;
  const prev = wasNew ? 0 : clampStars(previousStars);
  const prevUp = !wasNew && starsToRecommend(prev);
  const nextUp = starsToRecommend(next);
  return {
    ...entry,
    vote_count: entry.vote_count + (wasNew ? 1 : 0),
    star_sum: (entry.star_sum ?? 0) - prev + next,
    up_count: entry.up_count - (prevUp ? 1 : 0) + (nextUp ? 1 : 0),
  };
}

/**
 * The entry's tallies with one member's vote removed.
 *
 * The mirror of `applyLocalStarVote`. Clamped at zero on every counter: a
 * local estimate that has drifted must never render a negative vote count, and
 * the next fetch is what corrects it.
 */
export function applyLocalStarWithdraw<T extends {
  vote_count: number;
  up_count: number;
  star_sum?: number | null;
}>(entry: T, previousStars: number | undefined): T {
  if (previousStars == null) return entry;
  const prev = clampStars(previousStars);
  return {
    ...entry,
    vote_count: Math.max(0, entry.vote_count - 1),
    star_sum: Math.max(0, (entry.star_sum ?? 0) - prev),
    up_count: Math.max(0, entry.up_count - (starsToRecommend(prev) ? 1 : 0)),
  };
}

/**
 * The verdict bands, from the prototype's own thresholds.
 *
 * Composed as a descending ladder rather than by elimination. This codebase has
 * twice shipped a bug where a value fell through a `!==` branch and was treated
 * as its opposite, and the version of it here would tell a woman a film most of
 * us said to skip was worth her night.
 */
export function verdictFor(percent: number): ArchiveVerdict {
  if (percent >= 90) return 'Community favourite';
  if (percent >= 75) return 'Worth your night';
  if (percent >= 50) return 'Divisive';
  return 'Most of us said skip it';
}

export function formatScore(up: number, total: number, starSum?: number | null): ArchiveScore {
  // Nobody has rated it. There is no statistic to show and none to imply —
  // "0%" would read as a verdict and "NEW · 0 votes" reads as a defect. It is
  // simply unreviewed, and saying so is an invitation rather than an absence.
  if (total <= 0) {
    return {
      hasScore: false, percent: null, average: null, label: 'Unreviewed', verdict: null, total: 0,
    };
  }

  // star_sum of 0 with real votes is an un-backfilled baseline, not an
  // average of 0.0 — fall through to the recommend % until stars exist.
  if (starSum != null && Number.isFinite(starSum) && starSum > 0) {
    const raw = starSum / total;
    const average = Math.min(5, Math.max(0, Math.round(raw * 10) / 10));
    const percent = Math.round((average / 5) * 100);
    return {
      hasScore: true,
      percent,
      average,
      label: average.toFixed(1),
      verdict: verdictFor(percent),
      total,
    };
  }

  // A denormalized up_count above vote_count means a counter trigger drifted.
  // The only visible symptom would be a percentage over 100, so it is clamped
  // rather than rendered as nonsense — and the counters are recomputed rather
  // than incremented (097) precisely so this stays unreachable.
  const percent = Math.min(100, Math.round((up / total) * 100));

  return {
    hasScore: true,
    percent,
    average: null,
    label: `${percent}%`,
    verdict: verdictFor(percent),
    total,
  };
}

/** Colour band for the score pill and ring. Green / gold / rose, as the prototype. */
export type ScoreTone = 'good' | 'mixed' | 'poor' | 'none';

/**
 * Whether this tap is the first vote the entry has ever had.
 *
 * Casting that vote is the most valuable action in the Archive right now, and
 * it used to change a number silently. The screen uses this to show the
 * moment — and to invite a review — only when it actually landed first.
 */
export function firstVoteLanded(alreadyVoted: boolean, previousTotal: number): boolean {
  return !alreadyVoted && previousTotal === 0;
}

export function scoreFromEntry(
  entry: Pick<ArchiveEntry, 'up_count' | 'vote_count' | 'star_sum'>,
): ArchiveScore {
  return formatScore(entry.up_count, entry.vote_count, entry.star_sum);
}

export function scoreTone(score: ArchiveScore): ScoreTone {
  if (!score.hasScore || score.percent === null) return 'none';
  if (score.percent >= 75) return 'good';
  if (score.percent >= 50) return 'mixed';
  return 'poor';
}

// ── Queries ──────────────────────────────────────────────────────────────────

export type ArchiveEntry = {
  id: string;
  slug: string;
  title: string;
  media_type: ArchiveMediaType;
  release_year: number | null;
  creator: string | null;
  length_label: string | null;
  summary: string | null;
  cover_url: string | null;
  cover_gradient: string | null;
  vote_count: number;
  up_count: number;
  /** Sum of 1–5 star votes. Average is star_sum / vote_count. */
  star_sum?: number | null;
  review_count: number;
  has_score: boolean;
  published_at: string | null;
};

export type ArchiveSort = 'top' | 'voted' | 'newest' | 'needs';

const ENTRY_COLUMNS =
  'id, slug, title, media_type, release_year, creator, length_label, summary, ' +
  'cover_url, cover_gradient, vote_count, up_count, star_sum, review_count, has_score, published_at';

const ENTRY_COLUMNS_LEGACY =
  'id, slug, title, media_type, release_year, creator, length_label, summary, ' +
  'cover_url, cover_gradient, vote_count, up_count, review_count, has_score, published_at';

function missingStarSum(error: { message?: string; code?: string } | null): boolean {
  const message = error?.message ?? '';
  return error?.code === '42703' || /star_sum/i.test(message);
}

export type ArchiveQuery = {
  query?: string;
  mediaType?: ArchiveMediaType | null;
  sort?: ArchiveSort;
  limit?: number;
  /** Rows to skip — the next page of the browse list (ARC-07). */
  offset?: number;
};

/**
 * Whether a PostgREST error means "this RPC is not deployed here" rather than
 * "this RPC failed". Production runs the client before the owner applies 138,
 * and PostgREST then answers PGRST202 ("Could not find the function ... in the
 * schema cache"). That code, and only that code, is the cue for the fallback.
 * A 42883 or a bare 404 can come from the deployed engine itself (a function
 * it calls is missing, a proxy in front of it), and falling back there would
 * quietly swap a broken search for the old one with nothing in the logs.
 */
function isMissingRpc(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202';
}

/**
 * One breadcrumb per RPC per app session the first time the fallback runs, so
 * the owner can see that a build is running without 138, and when that stops.
 * It carries the RPC's name and nothing she typed. It never decides routing:
 * every request still asks the engine first.
 */
const fallbackNoted = new Set<string>();

function noteFallback(rpc: 'archive_search' | 'archive_search_facets'): void {
  if (fallbackNoted.has(rpc)) return;
  fallbackNoted.add(rpc);
  logBreadcrumb('archive_search_fallback', { rpc });
}

/**
 * The largest page `archive_search` serves; it refuses more with 22023 (HTTP
 * 400), which the screen can only show as an error. A caller that needs more
 * rows than a page reads them some other way (the watchlist reads by id).
 */
export const ARCHIVE_SEARCH_MAX_LIMIT = 50;

/**
 * `archive_search` refuses a query over 100 characters (22023), and the search
 * field has no maxLength, so a pasted paragraph would turn into "We couldn't
 * load the Archive". Cut it here instead. The cut counts code points, as
 * Postgres `length()` does, so an emoji on the edge stays whole rather than
 * leaving a lone surrogate the server would reject.
 */
const ARCHIVE_QUERY_MAX = 100;

function searchTerm(query: string | undefined): string | null {
  const trimmed = query?.trim() ?? '';
  if (!trimmed) return null;
  return Array.from(trimmed).slice(0, ARCHIVE_QUERY_MAX).join('');
}

/**
 * The browse list and the search, on the Archive search engine (138).
 *
 * `archive_search` matches the websearch syntax members already type (quotes,
 * `or`, `-word`), forgives typos and accents ("portrat", "Celine"), and orders
 * by the same four sorts this function always had. Rows come back shaped like
 * `archive_ranked_view`, so every caller reads them unchanged.
 *
 * A query leads with relevance whatever the sort (the sort breaks ties), so
 * "carol" puts Carol first. A page is at most `ARCHIVE_SEARCH_MAX_LIMIT` rows.
 *
 * When the RPC is missing (production before the owner applies 138), this runs
 * the title/creator ILIKE the screen used before, so the Archive never breaks.
 * There is no remembered "missing" flag: the first request after 138 lands
 * uses the engine.
 */
export async function fetchArchiveEntries(opts: ArchiveQuery = {}): Promise<ArchiveEntry[]> {
  const { query, mediaType, sort = 'top', limit = 50, offset = 0 } = opts;
  const page = Math.max(1, Math.min(limit, ARCHIVE_SEARCH_MAX_LIMIT));
  const { data, error } = await supabase.rpc('archive_search', {
    p_q: searchTerm(query),
    p_types: mediaType ? [mediaType] : null,
    p_sort: sort,
    p_limit: page,
    p_offset: offset,
  });
  if (!error) return (Array.isArray(data) ? data : []) as ArchiveEntry[];
  if (!isMissingRpc(error)) {
    logError(error, 'archive.fetchArchiveEntries');
    throw error;
  }
  noteFallback('archive_search');
  return fetchArchiveEntriesByTitle({ ...opts, limit: page });
}

/** Ids per `.in('id', …)` request: 100 uuids keep the URL near 4 KB, well under proxy limits. */
const BY_ID_CHUNK = 100;

/**
 * Specific entries, by id: her saved watchlist. Reads `archive_ranked_view`
 * (published only, the same columns as the browse list) with `.in('id', …)`,
 * in chunks, and never through `archive_search`, whose pages stop at 50.
 * Ordered as the watchlist always was: most voted first, then id. An id that
 * is no longer published simply does not come back.
 */
export async function fetchArchiveEntriesByIds(ids: readonly string[]): Promise<ArchiveEntry[]> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += BY_ID_CHUNK) chunks.push(unique.slice(i, i + BY_ID_CHUNK));
  const results = await Promise.all(chunks.map((chunk) => supabase
    .from('archive_ranked_view')
    .select(ENTRY_COLUMNS)
    .in('id', chunk)));
  const rows: ArchiveEntry[] = [];
  for (const res of results) {
    if (res.error) {
      logError(res.error, 'archive.fetchArchiveEntriesByIds');
      throw res.error;
    }
    rows.push(...((res.data ?? []) as unknown as ArchiveEntry[]));
  }
  return rows.sort((a, b) => b.vote_count - a.vote_count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The pre-138 browse list: `archive_ranked_view` with a title/creator ILIKE.
 * Reached only when `archive_search` is not deployed.
 *
 * "Top rated" filters to `has_score` before ordering. Sorting by percentage
 * without that filter puts every 1-vote entry at the top of the Archive, which
 * is the gate defeated by the sort — and the reason the gate is a stored column
 * rather than a client-side `if`.
 */
async function fetchArchiveEntriesByTitle(opts: ArchiveQuery): Promise<ArchiveEntry[]> {
  const { query, mediaType, sort = 'top', limit = 50, offset = 0 } = opts;

  let q = supabase
    .from('archive_ranked_view')
    .select('*');

  if (mediaType) q = q.eq('media_type', mediaType);
  if (query && query.trim()) {
    const pattern = ilikePattern(query);
    if (pattern) q = q.or(`title.ilike.${pattern},creator.ilike.${pattern}`);
  }

  if (sort === 'top') {
    q = q.order('rank_priority', { ascending: true }).order('calculated_percent', { ascending: false }).order('vote_count', { ascending: false });
  }
  else if (sort === 'voted') {
    q = q.order('vote_count', { ascending: false });
  }
  else if (sort === 'needs') {
    q = q.order('rank_priority', { ascending: false }).order('vote_count', { ascending: true });
  }
  else {
    q = q.order('published_at', { ascending: false });
  }

  // Every sort ends on `id` so a page edge between equal scores is stable —
  // without a unique last key, Postgres may return a tied row on both pages
  // or on neither. Only a later page needs the range; the first keeps the
  // plain limit every existing caller and test already reads.
  q = q.order('id', { ascending: true });
  const { data, error } = offset > 0
    ? await q.range(offset, offset + limit - 1)
    : await q.limit(limit);
  if (error) {
    logError(error, 'archive.fetchArchiveEntries');
    throw error;
  }

  return (data ?? []) as unknown as ArchiveEntry[];
}

const ARCHIVE_TYPES: ArchiveMediaType[] = ['film', 'tv', 'book', 'comic', 'music'];

/**
 * Published entries per media type, for the type chips.
 *
 * One `archive_search_facets` request (138), which returns a row per type,
 * zero included. A type the server omits still reads 0 here, so the chip
 * row never renders `undefined`. When the RPC is missing, this runs the five
 * head-only counts that replaced the 500-row fetch (ARC-13). A failed count
 * rejects; the screen then renders the chips without numbers.
 */
export async function fetchArchiveTypeCounts(): Promise<Record<ArchiveMediaType, number>> {
  const { data, error } = await supabase.rpc('archive_search_facets', {});
  if (!error) {
    const out = { film: 0, tv: 0, book: 0, comic: 0, music: 0 } as Record<ArchiveMediaType, number>;
    for (const row of (Array.isArray(data) ? data : []) as { media_type?: unknown; entry_count?: unknown }[]) {
      const type = ARCHIVE_TYPES.find((t) => t === row.media_type);
      if (type && typeof row.entry_count === 'number') out[type] = row.entry_count;
    }
    return out;
  }
  if (!isMissingRpc(error)) {
    logError(error, 'archive.fetchArchiveTypeCounts');
    throw error;
  }
  noteFallback('archive_search_facets');
  return fetchArchiveTypeHeadCounts();
}

/** The pre-138 chip counts: one head-only count per type. Reached only when the facets RPC is not deployed. */
async function fetchArchiveTypeHeadCounts(): Promise<Record<ArchiveMediaType, number>> {
  const types = ARCHIVE_TYPES;
  const results = await Promise.all(types.map((t) => supabase
    .from('archive_entries')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .eq('media_type', t)));
  const out = { film: 0, tv: 0, book: 0, comic: 0, music: 0 } as Record<ArchiveMediaType, number>;
  results.forEach((res, i) => {
    if (res.error) {
      logError(res.error, 'archive.fetchArchiveTypeCounts');
      throw res.error;
    }
    out[types[i]] = res.count ?? 0;
  });
  return out;
}

export async function fetchArchiveEntry(slug: string): Promise<ArchiveEntry | null> {
  let { data, error } = await supabase
    .from('archive_entries')
    .select(ENTRY_COLUMNS)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();

  if (error && missingStarSum(error)) {
    const retried = await supabase
      .from('archive_entries')
      .select(ENTRY_COLUMNS_LEGACY)
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();
    data = retried.data;
    error = retried.error;
  }

  if (error) {
    logError(error, 'archive.fetchArchiveEntry');
    throw error;
  }
  return (data as unknown as ArchiveEntry | null) ?? null;
}

// ── Entry detail ─────────────────────────────────────────────────────────────

export type ArchiveNoteRow = {
  id: string;
  label: string;
  agreeCount: number;
  agreed: boolean;
};

export type ArchiveReviewRow = {
  id: string;
  body: string;
  is_recommend: boolean;
  helpful_count: number;
  created_at: string;
  author: {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  } | null;
};

export type ArchiveEntryDetail = {
  notes: ArchiveNoteRow[];
  reviews: ArchiveReviewRow[];
  /** "runtime, 3 days ago by @mayalin.art", or null before any edit lands. */
  lastEdit: string | null;
};

/**
 * The design's "Last edit: …" credit, from the most recent APPROVED revision.
 *
 * It is what makes "member-maintained" a visible fact rather than a claim —
 * someone's name is on the most recent change. Null until an edit has actually
 * been published, because inventing a credit would be the exact opposite of
 * the thing it is there to demonstrate.
 */
export function describeLastEdit(
  fields: string[],
  reviewedAt: string | null,
  username: string | null
): string | null {
  if (!reviewedAt) return null;
  const when = relativeDay(reviewedAt);
  const what = fields.length > 0 ? fields.join(' & ') : 'details';
  return username ? `${what}, ${when} by @${username}` : `${what}, ${when}`;
}

function relativeDay(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'recently';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

/**
 * The two lists under an entry: its community content notes and its reviews.
 *
 * `agreed` is left false here and filled in by the store from
 * `noteAgreements` — this function is called for anyone, and whether SHE has
 * agreed is not a property of the note. Asking the server per-viewer would also
 * make the note rows uncacheable for a value the client already holds.
 *
 * Notes come back unfiltered; `visibleNotes` applies the >=3 agreement gate at
 * the point of render, so the entry screen can show the count of hidden ones
 * without a second query.
 */
export async function fetchArchiveEntryDetail(entryId: string): Promise<ArchiveEntryDetail> {
  const [notesRes, reviewsRes, editRes] = await Promise.all([
    supabase
      .from('archive_content_notes')
      .select('id, label, agree_count')
      .eq('entry_id', entryId)
      .eq('status', 'visible')
      .order('agree_count', { ascending: false }),
    supabase
      .from('archive_reviews')
      .select('id, body, is_recommend, helpful_count, created_at, author:profiles!archive_reviews_author_id_fkey(id, display_name, username, avatar_url)')
      .eq('entry_id', entryId)
      .eq('status', 'published')
      .order('helpful_count', { ascending: false })
      .limit(20),
    supabase
      .from('archive_revisions')
      .select('patch, reviewed_at, submitter:profiles!archive_revisions_submitted_by_fkey(username)')
      .eq('entry_id', entryId)
      .eq('status', 'approved')
      .order('reviewed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // One list failing is not the screen failing — the other still renders. A
  // missing notes list and a missing reviews list are different losses and
  // neither should take the entry down with it.
  if (notesRes.error) logError(notesRes.error, 'archive.fetchEntryDetail.notes');
  if (reviewsRes.error) logError(reviewsRes.error, 'archive.fetchEntryDetail.reviews');
  if (editRes.error) logError(editRes.error, 'archive.fetchEntryDetail.lastEdit');

  const edit = editRes.data as unknown as {
    patch?: Record<string, unknown> | null;
    reviewed_at?: string | null;
    submitter?: { username?: string | null } | null;
  } | null;

  const notes = ((notesRes.data ?? []) as unknown as { id: string; label: string; agree_count: number }[])
    .map((n) => ({ id: n.id, label: n.label, agreeCount: n.agree_count ?? 0, agreed: false }));

  return {
    notes,
    reviews: (reviewsRes.data ?? []) as unknown as ArchiveReviewRow[],
    lastEdit: edit
      ? describeLastEdit(
          Object.keys(edit.patch ?? {}),
          edit.reviewed_at ?? null,
          edit.submitter?.username ?? null
        )
      : null,
  };
}
