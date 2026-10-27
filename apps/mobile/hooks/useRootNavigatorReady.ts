import { useEffect, useState } from 'react';
import { useNavigationContainerRef } from 'expo-router';

/** How often to look while no navigator is mounted (the window is ~1.4–4 s). */
const READY_POLL_MS = 50;

/**
 * Has the root navigator mounted, so that router.replace/push may be called?
 *
 * expo-router's linkTo starts with assertIsReady(), which throws "Attempted to
 * navigate before mounting the Root Layout component" while the navigation
 * container has no navigator. app/_layout.tsx holds its navigator back until
 * the fonts load (a bare View on the first renders), so that window is real —
 * ~1.4 s on a cold load of roxy.expo.app, ~4 s on a slow font CDN — and an
 * uncaught throw there left the page blank for good (b2e54f94).
 *
 * The signal is the container ref's own `isReady()` (true once a navigator
 * has mounted), looked at on mount and then every READY_POLL_MS until it is
 * true. The ref emits no event when it becomes ready, and its first 'state'
 * event is not guaranteed, so it is polled — briefly, then never again.
 *
 * NOT `useRootNavigationState()`. In expo-router 3.5 that hook calls
 * `syncStoreRootState()` during render, which compares
 * `navigationRef.getRootState()` to the stored state by identity; react-
 * navigation builds a new object on every `getRootState()`, so every render
 * "changed" the store, notified its subscribers and re-rendered the caller —
 * "Maximum update depth exceeded" in <RootRedirects> and a blank page on every
 * load (caught on the local export, 2026-10-28; jest had mocked the hook).
 *
 * src: https://github.com/expo/expo/blob/sdk-51/packages/expo-router/src/hooks.ts (useNavigationContainerRef returns store.navigationRef; useRootNavigationState = useStoreRootState) · expo-router 3.5.24 · 2026-10-28
 * src: https://github.com/expo/expo/blob/sdk-51/packages/expo-router/src/global-state/router-store.tsx (useStoreRootState calls syncStoreRootState() in render; identity compare on getRootState()) · expo-router 3.5.24 · 2026-10-28
 * src: https://github.com/expo/expo/blob/sdk-51/packages/expo-router/src/global-state/routing.ts (assertIsReady in linkTo) · expo-router 3.5.24 · 2026-10-28
 */
export function useRootNavigatorReady(): boolean {
  const ref = useNavigationContainerRef();
  const [ready, setReady] = useState<boolean>(() => !!ref?.isReady?.());

  useEffect(() => {
    if (ready) return undefined;
    const check = () => {
      if (ref?.isReady?.()) setReady(true);
    };
    check();
    const id = setInterval(check, READY_POLL_MS);
    return () => clearInterval(id);
  }, [ref, ready]);

  return ready;
}
