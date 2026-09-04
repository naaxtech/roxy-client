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
  // Nobody has rated it. There is no statistic to show and none to imply —
  // "0%" would read as a verdict and "NEW · 0 votes" reads as a defect. It is
  // simply unreviewed, and saying so is an invitation rather than an absence.
  if (total <= 0) {
    return { hasScore: false, percent: null, label: 'Unreviewed', verdict: null, total: 0 };
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

export type ArchiveSort = 'top' | 'voted' | 'newest' | 'needs';

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

  if (sort === 'top' || sort === 'needs') {
    // Neither of these can be expressed in SQL — one ranks by a ratio, the
    // other by "has anyone rated this" — so both fetch and sort below.
    //
    // `top` used to add `.eq('has_score', true)`, and that was a latent
    // catastrophe: it was invisible while every entry carried seeded vote
    // weight, and the moment 104 removed the fabricated votes the DEFAULT view
    // returned zero rows and 45 real titles rendered as an empty Archive.
    // The >=10 rule is a reason to rank an unrated entry BELOW a rated one,
    // never a reason to pretend it is not in the catalogue.
    q = q.order('vote_count', { ascending: false });
  }
  else if (sort === 'voted') q = q.order('vote_count', { ascending: false });
  else q = q.order('published_at', { ascending: false });

  const { data, error } = await q.limit(limit);
  if (error) {
    logError(error, 'archive.fetchArchiveEntries');
    throw error;
  }

  const rows = (data ?? []) as unknown as ArchiveEntry[];

  if (sort === 'top') {
    // Three tiers, in this order:
    //   1. past the gate — a rating the community has actually earned
    //   2. rated but under the gate — real, just thin
    //   3. unrated
    // Within each, by ratio, then by sample size so 100% of ten does not
    // outrank 100% of a thousand. The gate ranks; it no longer hides.
    const tier = (e: ArchiveEntry) => (e.has_score ? 0 : e.vote_count > 0 ? 1 : 2);
    return [...rows].sort((a, b) => {
      if (tier(a) !== tier(b)) return tier(a) - tier(b);
      const ra = a.vote_count > 0 ? a.up_count / a.vote_count : 0;
      const rb = b.vote_count > 0 ? b.up_count / b.vote_count : 0;
      if (rb !== ra) return rb - ra;
      return b.vote_count - a.vote_count;
    });
  }

  if (sort === 'needs') {
    // The contribution path: what the Archive most needs a woman to rate.
    // Fewest votes first, so an entry nobody has touched leads.
    return [...rows].sort((a, b) => a.vote_count - b.vote_count);
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
      .select('id, body, is_recommend, helpful_count, created_at, author:profiles(id, display_name, username, avatar_url)')
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
