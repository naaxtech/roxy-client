'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Label } from '@/components/ui/label';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { cn } from '@/lib/utils';
import {
  CITY_ATTRIBUTION,
  CITY_SEARCH_DEBOUNCE_MS,
  CITY_SEARCH_MIN_CHARS,
  citySearchErrorMessage,
  formatCityLabel,
  type CityOption,
} from '@/lib/communityLocation';

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading'; q: string }
  | { kind: 'ready'; q: string; cities: CityOption[] }
  | { kind: 'error'; q: string; message: string };

type SearchRow = { id: unknown; name: unknown; admin1: unknown; country_code: unknown };

function toCities(data: unknown): CityOption[] {
  if (!Array.isArray(data)) return [];
  return (data as SearchRow[])
    .filter(
      (row) => typeof row.id === 'number' && typeof row.name === 'string' && typeof row.country_code === 'string',
    )
    .map((row) => ({
      id: row.id as number,
      name: row.name as string,
      admin1: typeof row.admin1 === 'string' ? row.admin1 : null,
      country_code: row.country_code as string,
    }));
}

interface CityComboboxProps {
  /** Unique per page: the input id; the listbox and option ids derive from it. */
  id: string;
  label?: string;
  value: CityOption | null;
  onChange: (city: CityOption | null) => void;
  disabled?: boolean;
}

/**
 * City picker over `search_cities` (2+ characters, debounced, biggest city first).
 *
 * Combobox semantics: the input owns focus; ArrowUp/ArrowDown move the active
 * option (aria-activedescendant), Enter picks it, Escape closes the list.
 * The text is local state seeded from `value`, so a parent that wants to reset
 * the field remounts it with a new `key`.
 */
export function CityCombobox({ id, label = 'City (optional)', value, onChange, disabled = false }: CityComboboxProps) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(() => (value ? formatCityLabel(value) : ''));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });

  const term = query.trim();
  const debounced = useDebouncedValue(term, CITY_SEARCH_DEBOUNCE_MS);
  const selectedLabel = value ? formatCityLabel(value) : null;
  const shouldSearch = debounced.length >= CITY_SEARCH_MIN_CHARS && debounced !== selectedLabel;

  useEffect(() => {
    if (!shouldSearch) return;
    // A newer query supersedes this one: its answer must not overwrite the newer list.
    let current = true;
    setSearch({ kind: 'loading', q: debounced });
    const fail = (message: string) => {
      if (current) setSearch({ kind: 'error', q: debounced, message });
    };
    try {
      createClient()
        .rpc('search_cities', { p_q: debounced })
        .then(
          ({ data, error }) => {
            if (!current) return;
            if (error) {
              fail(citySearchErrorMessage(error));
              return;
            }
            setActive(0);
            setSearch({ kind: 'ready', q: debounced, cities: toCities(data) });
          },
          () => fail(citySearchErrorMessage(null)),
        );
    } catch {
      fail(citySearchErrorMessage(null));
    }
    return () => {
      current = false;
    };
  }, [debounced, shouldSearch]);

  const listboxId = `${id}-listbox`;
  const statusId = `${id}-status`;
  const typing = open && term.length > 0 && term !== selectedLabel;
  const cities = search.kind === 'ready' ? search.cities : [];
  const showList = typing && term.length >= CITY_SEARCH_MIN_CHARS && cities.length > 0;
  const activeCity = showList ? cities[Math.min(active, cities.length - 1)] : undefined;
  const activeIndex = activeCity ? cities.indexOf(activeCity) : -1;

  let status: { text: string; tone: 'muted' | 'error' } | null = null;
  if (typing && !showList) {
    if (term.length < CITY_SEARCH_MIN_CHARS) {
      status = { text: `Type at least ${CITY_SEARCH_MIN_CHARS} letters.`, tone: 'muted' };
    } else if (search.kind === 'error') {
      status = { text: search.message, tone: 'error' };
    } else if (search.kind === 'ready' && search.q === term) {
      status = { text: `No cities match “${term}”.`, tone: 'muted' };
    } else {
      status = { text: 'Searching…', tone: 'muted' };
    }
  }

  const choose = (city: CityOption) => {
    setQuery(formatCityLabel(city));
    setOpen(false);
    onChange(city);
  };

  const clear = () => {
    setQuery('');
    setOpen(false);
    setSearch({ kind: 'idle' });
    if (value) onChange(null);
    input.current?.focus();
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeCity ? `${listboxId}-${activeIndex}` : undefined}
          aria-describedby={status ? statusId : undefined}
          type="text"
          value={query}
          disabled={disabled}
          placeholder="Search a city"
          autoComplete="off"
          spellCheck={false}
          maxLength={60}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              if (open) {
                event.preventDefault();
                setOpen(false);
              }
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              if (cities.length > 0) setActive((current) => Math.min(current + 1, cities.length - 1));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
              return;
            }
            if (event.key === 'Enter' && activeCity) {
              event.preventDefault();
              choose(activeCity);
            }
          }}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-9 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        />
        {query && !disabled ? (
          <button
            type="button"
            aria-label="Clear city"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}

        {showList ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Cities"
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {cities.map((city, index) => (
              <li
                key={city.id}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(city)}
                className={cn(
                  'cursor-pointer rounded px-3 py-2 text-sm',
                  index === activeIndex ? 'bg-muted' : 'hover:bg-muted/70',
                )}
              >
                {formatCityLabel(city)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {status ? (
        <p
          id={statusId}
          role={status.tone === 'error' ? 'alert' : 'status'}
          className={cn('text-xs', status.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
        >
          {status.text}
        </p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">{CITY_ATTRIBUTION}</p>
    </div>
  );
}
