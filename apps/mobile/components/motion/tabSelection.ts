import { useSyncExternalStore } from 'react';

/**
 * The tab the Tabs navigator has just committed, published by the tab bar
 * host in a layout effect — i.e. in the same commit that shows the new tab.
 *
 * TabFade used to learn about a switch only from React Navigation's 'state'
 * event, which fires after that commit, behind the new tab's own effects: at
 * 4x CPU the screencast showed ~4 frames of bare ground before the fade even
 * began (F4). A layout-effect publish makes subscribers re-render before the
 * browser paints, so the fade starts with the first ground frame.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export const tabSelection = {
  get: (): string | null => current,
  publish(key: string | null) {
    if (key === current) return;
    current = key;
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** The committed tab's route key (null before the tab bar has rendered). */
export function useCommittedTabKey(): string | null {
  return useSyncExternalStore(tabSelection.subscribe, tabSelection.get, tabSelection.get);
}
