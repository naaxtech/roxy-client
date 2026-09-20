import type { ArchiveMediaType } from './archive';

/**
 * What the Archive calls its media types.
 *
 * The chips read "Film", "TV" and "Comic" — the raw enum values, capitalised.
 * Nobody browsing a catalogue at eleven at night thinks "I'll have a Film"; she
 * thinks movies, series, manga. So the label layer is separate from the column:
 * `archive_media_type` stays exactly as it is, because it is an enum in a live
 * table with 45 rows against it, and only what she reads changes.
 *
 * "Comics & Manga" is the one that mattered most. "Comic" excluded manga by
 * implication, and manga is a large part of what this category holds for a wlw
 * audience — a filter that reads as excluding your thing is a filter you do not
 * tap.
 */

export type ArchiveTypeFilter = {
  /** null is "everything" — the absence of a filter, not a sixth type. */
  value: ArchiveMediaType | null;
  key: string;
};

export const ARCHIVE_TYPE_FILTERS: ArchiveTypeFilter[] = [
  { value: null, key: 'all' },
  { value: 'film', key: 'film' },
  { value: 'tv', key: 'tv' },
  { value: 'book', key: 'book' },
  { value: 'comic', key: 'comic' },
  { value: 'music', key: 'music' },
];

const LABELS: Record<string, string> = {
  all: 'Everything',
  film: 'Movies',
  tv: 'Series',
  book: 'Books',
  comic: 'Comics & Manga',
  music: 'Music',
};

/** One glyph per type, so the row is scannable before it is read. */
const ICONS: Record<string, string> = {
  all: '✦',
  film: '🎬',
  tv: '📺',
  book: '📖',
  comic: '💥',
  music: '♫',
};

export function archiveTypeLabel(value: ArchiveMediaType | null): string {
  return LABELS[value ?? 'all'];
}

export function archiveTypeIcon(value: ArchiveMediaType | null): string {
  return ICONS[value ?? 'all'];
}

export type TypeCounts = Record<ArchiveMediaType, number>;

const EMPTY_COUNTS: TypeCounts = { film: 0, tv: 0, book: 0, comic: 0, music: 0 };

/**
 * How many published entries each type has.
 *
 * Every key is present and zero rather than absent. A chip rendering
 * `undefined` reads as a loading state; a chip rendering `0` reads as an empty
 * category, which is the truth and is worth knowing before she taps it.
 *
 * A type the client does not recognise is ignored rather than counted. The enum
 * can gain a value before the app ships support for it, and an unknown type
 * must not crash the row or land in someone else's total.
 */
export function countByType(rows: { media_type: string }[]): TypeCounts {
  const counts: TypeCounts = { ...EMPTY_COUNTS };
  for (const row of rows) {
    if (row.media_type in counts) {
      counts[row.media_type as ArchiveMediaType] += 1;
    }
  }
  return counts;
}

/** What a given chip should show — All is the sum, a type is its own. */
export function filterCount(value: ArchiveMediaType | null, counts: TypeCounts): number {
  if (value === null) {
    return Object.values(counts).reduce((sum, n) => sum + n, 0);
  }
  return counts[value] ?? 0;
}
