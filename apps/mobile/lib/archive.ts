import { supabase } from './supabase';
import { logError } from './errorLogger';
import { ilikePattern } from './ilikePattern';

/**
 * The WLW Archive — scoring, and the queries behind it.
 *
 * One score, one question: "would you recommend this to another wlw?" Yes or
 * no, aggregated into a single % recommend. No stars, no critic score, no
 * sub-scores — the whole point is that a woman deciding what to watch tonight
 * gets one number from people like her.
 *
 * Every surface reads the score through `formatScore`. That is not a style
 * preference: the gate below is the only thing standing between the browse list
 * and a row that says 100% because one person liked it, and a second call site
 * doing its own division is how that rule gets lost.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · markup 952–1090, behaviour 1977–2032 · 2026-09-01
 */

/**
 * How many votes an entry needs before it shows a number at all.
 *
 * Mirrored by `archive_entries.has_score` (migration 095) so the ORDER BY and
 * the label agree — "Top rated" leading with an unearned 100% is the same bug
 * in a different clause. `__tests__/lib/archiveScore.test.ts` reads the
 * threshold out of the migration and fails if the two drift.
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
  /** 0–100, or null below the gate. Never a number the entry has not earned. */
  percent: number | null;
  /** What to render: "84%" or "NEW · 3 votes". */
  label: string;
  /** The sentence under the ring, or null below the gate. */
  verdict: ArchiveVerdict | null;
  total: number;
};

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

export function formatScore(up: number, total: number): ArchiveScore {
  if (total < SCORE_GATE) {
    return {
      hasScore: false,
      percent: null,
      label: `NEW · ${total} ${total === 1 ? 'vote' : 'votes'}`,
      verdict: null,
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
    label: `${percent}%`,
    verdict: verdictFor(percent),
    total,
  };
}

/** Colour band for the score pill and ring. Green / gold / rose, as the prototype. */
export type ScoreTone = 'good' | 'mixed' | 'poor' | 'none';

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
  review_count: number;
  has_score: boolean;
  published_at: string | null;
};

export type ArchiveSort = 'top' | 'voted' | 'newest';

const ENTRY_COLUMNS =
  'id, slug, title, media_type, release_year, creator, length_label, summary, ' +
  'cover_url, cover_gradient, vote_count, up_count, review_count, has_score, published_at';

export type ArchiveQuery = {
  query?: string;
  mediaType?: ArchiveMediaType | null;
  sort?: ArchiveSort;
  limit?: number;
};

/**
 * The browse list.
 *
 * "Top rated" filters to `has_score` before ordering. Sorting by percentage
 * without that filter puts every 1-vote entry at the top of the Archive, which
 * is the gate defeated by the sort — and the reason the gate is a stored column
 * rather than a client-side `if`.
 */
export async function fetchArchiveEntries(opts: ArchiveQuery = {}): Promise<ArchiveEntry[]> {
  const { query, mediaType, sort = 'top', limit = 50 } = opts;

  let q = supabase
    .from('archive_entries')
    .select(ENTRY_COLUMNS)
    .eq('status', 'published');

  if (mediaType) q = q.eq('media_type', mediaType);
  if (query && query.trim()) {
    // Reuses the escaper every other search path in this app goes through: a
    // comma reads as PostgREST's clause separator and `%` / `_` are ILIKE
    // wildcards, so an unescaped title with a comma in it silently empties the
    // Archive.
    const pattern = ilikePattern(query);
    if (pattern) q = q.or(`title.ilike.${pattern},creator.ilike.${pattern}`);
  }

  if (sort === 'top') q = q.eq('has_score', true).order('up_count', { ascending: false });
  else if (sort === 'voted') q = q.order('vote_count', { ascending: false });
  else q = q.order('published_at', { ascending: false });

  const { data, error } = await q.limit(limit);
  if (error) {
    logError(error, 'archive.fetchArchiveEntries');
    throw error;
  }
  // The generated Database types do not know the archive tables yet, so the
  // client infers PostgREST's error shape here. Cast through unknown rather
  // than widening the row type and losing it everywhere else.
  return (data ?? []) as unknown as ArchiveEntry[];
}

export async function fetchArchiveEntry(slug: string): Promise<ArchiveEntry | null> {
  const { data, error } = await supabase
    .from('archive_entries')
    .select(ENTRY_COLUMNS)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();

  if (error) {
    logError(error, 'archive.fetchArchiveEntry');
    throw error;
  }
  return (data as unknown as ArchiveEntry | null) ?? null;
}
