import { useSyncExternalStore } from 'react';
import { Snackbar, SNACKBAR_DURATION } from '../ui/Snackbar';
import { FAB_LANE, NAV_HEIGHT, NAV_MIN_BOTTOM } from '../nav/navTokens';

/**
 * One snackbar host for the whole app + an imperative API (polish/motion-spec.md
 * §3.1 row 13; budget F10's "rolls back with a snackbar and Retry"). Wave 3
 * lane C0.
 *
 *   snackbar.show({ message: 'Not sent.', actionLabel: 'Retry', onAction: retry })
 *
 * Mount `<SnackbarHost />` ONCE, at the root, above the navigator. It renders
 * the existing `components/ui/Snackbar` (inverse surface, springs in on
 * `spatial`, polite alert, Reduce Motion: simply appears). M3: one at a time —
 * a new snackbar replaces the current one and gets its full time: 4 s alone
 * (`SNACKBAR_SHORT_MS`), 6 s with an action (`SNACKBAR_DURATION`), or the
 * call's `duration`. One sentence, no guilt; errors never buzz.
 *
 * Placement: above the nav bar and the Roxy button's lane by default
 * (`SNACKBAR_HOST_BOTTOM`); a host prop or a per-call `bottom` overrides it.
 * Swipe-to-dismiss belongs to `Snackbar` itself (Lane C).
 */

/** How long a snackbar without an action stays (ms). */
export const SNACKBAR_SHORT_MS = 4000;

/** Default distance from the bottom: above the bar and the FAB lane. */
export const SNACKBAR_HOST_BOTTOM = NAV_HEIGHT + NAV_MIN_BOTTOM + FAB_LANE;

export type SnackbarOptions = {
  /** One sentence. */
  message: string;
  /** e.g. "Retry", "Undo", "View". */
  actionLabel?: string;
  onAction?: () => void;
  /** ms; default 4000, or 6000 with an action. */
  duration?: number;
  /** Distance from the bottom (dp) for this one. */
  bottom?: number;
};

type Item = SnackbarOptions & { id: number };

let current: Item | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export const snackbar = {
  /** Show a snackbar (replacing any on screen). Returns its id. */
  show(options: SnackbarOptions): number {
    const id = nextId;
    nextId += 1;
    current = { ...options, id };
    emit();
    return id;
  },
  /** Dismiss snackbar `id`, or whatever is showing when no id is given. */
  dismiss(id?: number): void {
    if (!current || (id !== undefined && current.id !== id)) return;
    current = null;
    emit();
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getCurrent = (): Item | null => current;

/** The same imperative API, for components that prefer a hook. */
export function useSnackbar(): typeof snackbar {
  return snackbar;
}

export function SnackbarHost({ bottom = SNACKBAR_HOST_BOTTOM, testID = 'snackbar' }: { bottom?: number; testID?: string }) {
  const item = useSyncExternalStore(subscribe, getCurrent, getCurrent);
  if (!item) return null;
  return (
    <Snackbar
      key={item.id}
      visible
      message={item.message}
      actionLabel={item.actionLabel}
      onAction={item.onAction}
      onDismiss={() => snackbar.dismiss(item.id)}
      duration={item.duration ?? (item.actionLabel && item.onAction ? SNACKBAR_DURATION : SNACKBAR_SHORT_MS)}
      bottom={item.bottom ?? bottom}
      testID={testID}
    />
  );
}
