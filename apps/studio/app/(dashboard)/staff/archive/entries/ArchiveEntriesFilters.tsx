'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QuickSearch } from '@/components/QuickSearch';
import { Button } from '@/components/ui/button';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import {
  ARCHIVE_COVER_FILTERS,
  ARCHIVE_SCORE_FILTERS,
  ARCHIVE_SORTS,
  archiveFilterCount,
  archiveFilterHref,
  EMPTY_ARCHIVE_FILTERS,
  type ArchiveCoverFilter,
  type ArchiveEntryFilters,
  type ArchiveScoreFilter,
  type ArchiveSort,
} from '@/lib/archiveFilters';
import { ARCHIVE_MEDIA_TYPES, ARCHIVE_STATUSES } from '@/lib/archiveEntry';

const SCORE_LABELS: Record<ArchiveScoreFilter, string> = {
  all: 'Any score',
  scored: 'Has a score',
  below: 'Below the gate',
  none: 'No votes yet',
};

const COVER_LABELS: Record<ArchiveCoverFilter, string> = {
  all: 'Any cover',
  yes: 'Has a photo',
  no: 'Missing photo',
};

const SORT_LABELS: Record<ArchiveSort, string> = {
  updated: 'Recently updated',
  title: 'Title',
  year: 'Year',
  votes: 'Most votes',
};

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button type="button" size="sm" variant={active ? 'default' : 'outline'} onClick={onClick}>
      {children}
    </Button>
  );
}

export function ArchiveEntriesFilters({
  initial,
  resultCount,
}: {
  initial: ArchiveEntryFilters;
  resultCount: number;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState(initial);
  const debouncedQ = useDebouncedValue(filters.q, 220);

  const commit = (next: ArchiveEntryFilters) => {
    router.replace(archiveFilterHref(next));
  };

  useEffect(() => {
    setFilters(initial);
  }, [initial]);

  useEffect(() => {
    if (debouncedQ === initial.q) return;
    commit({ ...filters, q: debouncedQ });
    // Only the debounced query should hit the server; chips commit immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const patch = (partial: Partial<ArchiveEntryFilters>) => {
    const next = { ...filters, ...partial };
    setFilters(next);
    if (partial.q === undefined) commit(next);
  };

  const active = archiveFilterCount(filters);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <QuickSearch
          id="archive-q"
          label="Search the catalogue"
          value={filters.q}
          placeholder="Title, creator, slug, description…"
          onChange={(q) => setFilters((current) => ({ ...current, q }))}
          onSubmit={(q) => commit({ ...filters, q })}
        />
        <div className="space-y-1.5">
          <label htmlFor="archive-sort" className="text-sm font-medium">
            Sort
          </label>
          <select
            id="archive-sort"
            value={filters.sort}
            onChange={(event) => patch({ sort: event.target.value as ArchiveSort })}
            className="flex h-10 rounded-xl border border-input bg-muted/40 px-3 text-sm"
          >
            {ARCHIVE_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Status</p>
        <div className="flex flex-wrap gap-2">
          <Chip active={filters.status === ''} onClick={() => patch({ status: '' })}>
            All
          </Chip>
          {ARCHIVE_STATUSES.map((status) => (
            <Chip
              key={status}
              active={filters.status === status}
              onClick={() => patch({ status })}
            >
              {status[0].toUpperCase() + status.slice(1)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Type</p>
        <div className="flex flex-wrap gap-2">
          <Chip active={filters.type === ''} onClick={() => patch({ type: '' })}>
            All
          </Chip>
          {ARCHIVE_MEDIA_TYPES.map((type) => (
            <Chip key={type} active={filters.type === type} onClick={() => patch({ type })}>
              {type === 'tv' ? 'TV' : type[0].toUpperCase() + type.slice(1)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Score</p>
          <div className="flex flex-wrap gap-2">
            {ARCHIVE_SCORE_FILTERS.map((score) => (
              <Chip key={score} active={filters.score === score} onClick={() => patch({ score })}>
                {SCORE_LABELS[score]}
              </Chip>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Cover</p>
          <div className="flex flex-wrap gap-2">
            {ARCHIVE_COVER_FILTERS.map((cover) => (
              <Chip key={cover} active={filters.cover === cover} onClick={() => patch({ cover })}>
                {COVER_LABELS[cover]}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="archive-year-from" className="text-xs font-medium text-muted-foreground">
            Year from
          </label>
          <input
            id="archive-year-from"
            inputMode="numeric"
            value={filters.yearFrom}
            placeholder="1990"
            onChange={(event) => patch({ yearFrom: event.target.value.replace(/\D/g, '').slice(0, 4) })}
            className="flex h-10 w-24 rounded-xl border border-input bg-muted/40 px-3 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="archive-year-to" className="text-xs font-medium text-muted-foreground">
            Year to
          </label>
          <input
            id="archive-year-to"
            inputMode="numeric"
            value={filters.yearTo}
            placeholder="2026"
            onChange={(event) => patch({ yearTo: event.target.value.replace(/\D/g, '').slice(0, 4) })}
            className="flex h-10 w-24 rounded-xl border border-input bg-muted/40 px-3 text-sm"
          />
        </div>
        <p className="text-sm text-muted-foreground pb-2">
          {resultCount} {resultCount === 1 ? 'entry' : 'entries'}
          {active > 0 ? ` · ${active} filter${active === 1 ? '' : 's'}` : ''}
        </p>
        {active > 0 || filters.q ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(EMPTY_ARCHIVE_FILTERS);
              commit(EMPTY_ARCHIVE_FILTERS);
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
