import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pull-to-refresh state for `RoxyRefresh` (motion spec §3.1 row 7, F7, F11).
 *
 * `refreshing` is true only while HER pull runs, from the release until the
 * reload resolves, so the indicator never doubles up with a first-load
 * skeleton or a background refresh. `onRefresh` may return a promise; keep it
 * pending until the new content is on screen.
 */
export function usePullRefresh(onRefresh?: () => void | Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const pull = useCallback(() => {
    if (!onRefresh) return;
    setRefreshing(true);
    void Promise.resolve()
      .then(() => onRefresh())
      .catch(() => undefined)
      .finally(() => { if (alive.current) setRefreshing(false); });
  }, [onRefresh]);
  return { refreshing, onRefresh: pull, enabled: !!onRefresh };
}
