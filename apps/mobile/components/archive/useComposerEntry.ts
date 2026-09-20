import { useCallback, useEffect, useState } from 'react';
import { fetchArchiveEntry, type ArchiveEntry } from '../../lib/archive';
import { logError } from '../../lib/errorLogger';

export type ComposerEntryStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export type ComposerEntry = {
  entry: ArchiveEntry | null;
  status: ComposerEntryStatus;
  reload: () => void;
};

/**
 * The entry a composer is about.
 *
 * Three of the four Archive sheets — write a review, suggest an edit, add a
 * content note — are always *about* something, and all three need the same four
 * answers: loading, ready, missing, error. Written once because a composer that
 * gets this wrong is a form she fills in and then cannot submit.
 *
 * `missing` is its own state rather than folded into `error`. An entry that was
 * merged away is a different thing to tell her than a network that is down: one
 * asks her to go back, the other asks her to try again, and a composer that
 * offers "try again" for a slug that will never resolve is a loop.
 *
 * Nothing happens without a slug. `useLocalSearchParams` returns undefined on
 * the first render, and a fetch fired on that would query for nothing and
 * report `missing` before the real slug ever arrived.
 */
export function useComposerEntry(slug: string | undefined): ComposerEntry {
  const [entry, setEntry] = useState<ArchiveEntry | null>(null);
  const [status, setStatus] = useState<ComposerEntryStatus>(slug ? 'loading' : 'idle');
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setStatus('loading');

    void (async () => {
      try {
        const found = await fetchArchiveEntry(slug);
        if (cancelled) return;
        if (!found) { setEntry(null); setStatus('missing'); return; }
        setEntry(found);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        // fetchArchiveEntry logs before it throws, but it can also be handed a
        // rejection from somewhere else; logging here keeps the hook's own
        // failure attributable rather than anonymous.
        logError(e, 'useComposerEntry');
        setStatus('error');
      }
    })();

    return () => { cancelled = true; };
  }, [slug, attempt]);

  return { entry, status, reload };
}
