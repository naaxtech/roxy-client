'use client';

import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickSearchProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function QuickSearch({
  id,
  label,
  value,
  onChange,
  onSubmit,
  placeholder = 'Search…',
  className,
}: QuickSearchProps) {
  return (
    <div className={cn('space-y-1.5 min-w-[12rem] flex-1', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit?.(value);
            }
            if (event.key === 'Escape' && value) {
              event.preventDefault();
              onChange('');
              onSubmit?.('');
            }
          }}
          className="flex h-10 w-full rounded-xl border border-input bg-background text-foreground pl-9 pr-9 text-sm shadow-none transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              onChange('');
              onSubmit?.('');
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
