'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { studioSearchHits } from '@/lib/studioSearch';
import { cn } from '@/lib/utils';

interface StudioSearchProps {
  isStaff?: boolean;
  isCore?: boolean;
}

function shortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl K';
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
}

export function StudioSearch({ isStaff = false, isCore = false }: StudioSearchProps) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const hits = useMemo(
    () => studioSearchHits(query, { isStaff, isCore }),
    [query, isStaff, isCore],
  );
  const showResults = open && query.trim().length > 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    return () => window.removeEventListener('mousedown', onPointer);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  };

  return (
    <div ref={box} className="relative z-[80] w-44 shrink-0 sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={input}
        role="combobox"
        aria-label="Search Studio"
        aria-expanded={showResults}
        aria-controls="studio-search-results"
        aria-autocomplete="list"
        aria-activedescendant={showResults && hits[active] ? `studio-search-hit-${active}` : undefined}
        type="search"
        value={query}
        placeholder="Search…"
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (query) {
              event.preventDefault();
              setQuery('');
              return;
            }
            setOpen(false);
            input.current?.blur();
          }
          if (!showResults || hits.length === 0) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((current) => Math.min(current + 1, hits.length - 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          }
          if (event.key === 'Enter' && hits[active]) {
            event.preventDefault();
            go(hits[active].href);
          }
        }}
        className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-14 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => {
            setQuery('');
            input.current?.focus();
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
          {shortcutLabel()}
        </kbd>
      )}

      {showResults ? (
        <ul
          id="studio-search-results"
          data-testid="studio-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-[90] mt-1 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {hits.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              Nothing matches that.
            </li>
          ) : (
            hits.map((hit, index) => (
              <li key={hit.href} role="presentation">
                <button
                  type="button"
                  id={`studio-search-hit-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(hit.href)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left',
                    index === active ? 'bg-muted' : 'hover:bg-muted/70',
                  )}
                >
                  <span className="text-sm font-medium">{hit.label}</span>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {hit.section}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
