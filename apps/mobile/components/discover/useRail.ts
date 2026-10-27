import { useCallback, useEffect, useRef, useState } from 'react';
import type { RailStatus } from './Rail';
import { readCache, writeCache, type CacheScope } from '../../lib/cacheFirst';
import { useAuthStore } from '../../store/authStore';

/**
 * One loader per rail, each with its own status.
 *
 * Deliberately not a single `Promise.all` behind one status flag: seven rails
 * sharing one spinner means a slow `feature-vote` edge function holds up the
 * events rail that already has its data, and one failure blanks a screen where
 * six of seven things worked. Each rail loads, fails and retries on its own.
 *
 * Lives in its own module (it was private to `useDiscoverData.ts`) so rails
 * outside that file, such as Near you, reuse it, while the Discover screen
 * suites that mock `useDiscoverData` wholesale keep working.
 */
export type RailData<T> = { rows: T[]; status: RailStatus; reload: () => void };

/**
 * `cache` (decision P2, budget F7): the rail paints her last-known rows from
 * `lib/cacheFirst` while the network is out, the network answer replaces them
 * and is kept for next time, and a failed refresh keeps what she can see. A
 * network answer that lands first wins. Rails whose data goes stale in minutes
 * (live rooms), or that must not touch the disk (Near you), pass no scope.
 *
 * `loader` returns null for a failure (the rail shows Try again).
 */
export function useRail<T>(loader: () => Promise<T[] | null>, deps: unknown[], cache?: CacheScope): RailData<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [status, setStatus] = useState<RailStatus>('loading');
  /** The newest run: an answer to a superseded one (her filters changed meanwhile) is dropped. */
  const latest = useRef(0);

  const run = useCallback(async () => {
    const mine = ++latest.current;
    setStatus('loading');
    const userId = cache ? useAuthStore.getState().user?.id : undefined;
    let answered = false;
    let showing = false;
    if (cache && userId) {
      void readCache<T[]>(userId, cache).then((known) => {
        if (answered || mine !== latest.current || !known || known.length === 0) return;
        showing = true;
        setRows(known);
        setStatus('ready');
      });
    }
    const result = await loader();
    answered = true;
    if (mine !== latest.current) return;
    // State before logging, always — a throwing logger must never leave a rail
    // spinning. See `lib/errorLogger.ts`.
    if (result === null) {
      // She is already looking at her last-known rows: keep them.
      if (!showing) setStatus('error');
      return;
    }
    setRows(result);
    setStatus('ready');
    if (cache && userId) void writeCache(userId, cache, result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void run(); }, [run]);

  return { rows, status, reload: () => void run() };
}
