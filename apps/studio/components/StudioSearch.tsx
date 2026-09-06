'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { studioSearchHits } from '@/lib/studioSearch';
import { Button } from '@/components/ui/button';
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const hits = useMemo(
    () => studioSearchHits(query, { isStaff, isCore }),
    [query, isStaff, isCore],
  );

  useEffect(() => {
    setActive(0);
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="hidden sm:inline-flex h-8 gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Search className="h-3.5 w-3.5" />
        Search
        <kbd className="rounded border bg-muted px-1.5 text-[10px] font-medium">{shortcutLabel()}</kbd>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="sm:hidden h-8 w-8 text-muted-foreground"
        aria-label="Search Studio"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Search Studio"
            className="w-full max-w-lg overflow-hidden rounded-2xl border bg-card shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative border-b">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                type="search"
                value={query}
                placeholder="Jump to a page…"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActive((current) => Math.min(current + 1, Math.max(hits.length - 1, 0)));
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActive((current) => Math.max(current - 1, 0));
                  }
                  if (event.key === 'Enter' && hits[active]) go(hits[active].href);
                }}
                className="h-12 w-full bg-card text-foreground pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ul className="max-h-80 overflow-y-auto p-2">
              {hits.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nothing matches that.
                </li>
              ) : (
                hits.map((hit, index) => (
                  <li key={hit.href}>
                    <button
                      type="button"
                      onClick={() => go(hit.href)}
                      onMouseEnter={() => setActive(index)}
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
          </div>
        </div>
      ) : null}
    </>
  );
}
