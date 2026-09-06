import { ARCHIVE_MEDIA_TYPES, ARCHIVE_STATUSES } from '@/lib/archiveEntry';

export const ARCHIVE_SCORE_FILTERS = ['all', 'scored', 'below', 'none'] as const;
export const ARCHIVE_COVER_FILTERS = ['all', 'yes', 'no'] as const;
export const ARCHIVE_SORTS = ['updated', 'title', 'year', 'votes'] as const;

export type ArchiveScoreFilter = (typeof ARCHIVE_SCORE_FILTERS)[number];
export type ArchiveCoverFilter = (typeof ARCHIVE_COVER_FILTERS)[number];
export type ArchiveSort = (typeof ARCHIVE_SORTS)[number];

export type ArchiveEntryFilters = {
  q: string;
  status: string;
  type: string;
  score: ArchiveScoreFilter;
  cover: ArchiveCoverFilter;
  yearFrom: string;
  yearTo: string;
  sort: ArchiveSort;
};

export const EMPTY_ARCHIVE_FILTERS: ArchiveEntryFilters = {
  q: '',
  status: '',
  type: '',
  score: 'all',
  cover: 'all',
  yearFrom: '',
  yearTo: '',
  sort: 'updated',
};

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseArchiveEntryFilters(
  params: Record<string, string | string[] | undefined>,
): ArchiveEntryFilters {
  const read = (key: string) => {
    const value = params[key];
    return typeof value === 'string' ? value : '';
  };
  const status = read('status');
  const type = read('type');
  return {
    q: read('q').trim(),
    status: (ARCHIVE_STATUSES as readonly string[]).includes(status) ? status : '',
    type: (ARCHIVE_MEDIA_TYPES as readonly string[]).includes(type) ? type : '',
    score: oneOf(read('score'), ARCHIVE_SCORE_FILTERS, 'all'),
    cover: oneOf(read('cover'), ARCHIVE_COVER_FILTERS, 'all'),
    yearFrom: read('year_from').replace(/\D/g, '').slice(0, 4),
    yearTo: read('year_to').replace(/\D/g, '').slice(0, 4),
    sort: oneOf(read('sort'), ARCHIVE_SORTS, 'updated'),
  };
}

export function archiveFiltersToSearchParams(filters: ArchiveEntryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.score !== 'all') params.set('score', filters.score);
  if (filters.cover !== 'all') params.set('cover', filters.cover);
  if (filters.yearFrom) params.set('year_from', filters.yearFrom);
  if (filters.yearTo) params.set('year_to', filters.yearTo);
  if (filters.sort !== 'updated') params.set('sort', filters.sort);
  return params;
}

export function archiveFilterHref(filters: ArchiveEntryFilters): string {
  const qs = archiveFiltersToSearchParams(filters).toString();
  return qs ? `/staff/archive/entries?${qs}` : '/staff/archive/entries';
}

/** How many filters are on besides the search box. */
export function archiveFilterCount(filters: ArchiveEntryFilters): number {
  let count = 0;
  if (filters.status) count += 1;
  if (filters.type) count += 1;
  if (filters.score !== 'all') count += 1;
  if (filters.cover !== 'all') count += 1;
  if (filters.yearFrom) count += 1;
  if (filters.yearTo) count += 1;
  if (filters.sort !== 'updated') count += 1;
  return count;
}

export function parseYearBound(value: string): number | null {
  if (!value) return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1800 || year > 2200) return null;
  return year;
}
