'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CopyState = 'idle' | 'copied' | 'failed';

interface CopyButtonProps {
  /** The text placed on the clipboard. */
  value: string;
  /** Accessible name — "Copy invite code 8QF3TK2P9M", not just "Copy". */
  ariaLabel: string;
  className?: string;
}

/**
 * Copy-to-clipboard with an honest failure path.
 *
 * `navigator.clipboard` is undefined outside a secure context and can be
 * refused by permissions policy, so the failure is shown rather than swallowed:
 * an admin who thinks she copied a code and pastes the previous one has sent
 * someone the wrong key to the door.
 */
export function CopyButton({ value, ariaLabel, className }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 5000);
  }, [value]);

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void copy()}
        aria-label={ariaLabel}
      >
        {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {state === 'copied' ? 'Copied' : 'Copy'}
      </Button>
      <span role="status" aria-live="polite">
        {state === 'copied' && <span className="sr-only">Copied to your clipboard.</span>}
        {state === 'failed' && (
          <span className="text-xs text-destructive">
            Copy did not work — select the code and copy it by hand.
          </span>
        )}
      </span>
    </span>
  );
}
