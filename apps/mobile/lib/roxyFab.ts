import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { makeMutable, runOnJS, useAnimatedScrollHandler } from 'react-native-reanimated';

/**
 * The Roxy AI button's state (design direction v2 › The Roxy AI button).
 *
 * Three things live here, and nowhere else:
 *  - **enabled**: whether Roxy AI is switched on (Settings › Roxy AI, M173).
 *    Kept on this phone PER MEMBER (`roxy_ai_enabled_v1:<userId>`), so a second
 *    account signing in on the same phone starts with her on, not with the
 *    last member's choice. Default: on. Optimistic: the button leaves the
 *    screen before storage answers.
 *  - **tucked**: whether she rests tucked into the screen edge because list
 *    content sits in her lane (see `nextTuck`; M3's extended-FAB collapse,
 *    made Roxy's, with the lane rule on top).
 *  - **onListScroll**: a plain `onScroll` handler any list passes straight in
 *    (`onScroll={onListScroll} scrollEventThrottle={16}`), plus
 *    `onListContentSizeChange`; `useFabScrollHandler` is the UI-thread form
 *    for Animated lists. Not the Feed pager: on the Feed she never tucks.
 *
 * Why not a server column: Roxy AI on/off is a per-device presentation choice
 * today (the FAB), and `profiles` has no column for it. If it has to follow her
 * across devices, add a column and sync here, the way `themeStore` does.
 */

export const ROXY_AI_ENABLED_KEY = 'roxy_ai_enabled_v1';

/** The storage key for one member's choice. */
export function enabledKeyFor(userId: string): string {
  return `${ROXY_AI_ENABLED_KEY}:${userId}`;
}

/*
 * RETIRED (Wave 3, lane C, 2026-10-23): the Wave 2 hysteresis rule (tuck after
 * TUCK_THRESHOLD dp down, back after TUCK_THRESHOLD dp up, always out within
 * EDGE_ZONE of the top). Origin: lane roxy-ai (`git log -S TUCK_THRESHOLD`).
 * Why: it brought her back at the top of every list and on every scroll up, so
 * at rest at 360 x 800 she sat on Discover's "Joined", You's "Apply" and
 * Settings' Ghost mode switch (wave2/ship/shots/local-360/report.json). The
 * constants stay exported for any caller; nothing in the app reads them now.
 */
/** RETIRED with the hysteresis rule (see above). */
export const TUCK_THRESHOLD = 12;
/** RETIRED with the hysteresis rule (see above). */
export const EDGE_ZONE = 24;

/**
 * How close (dp) to the end of a list counts as the end. Only rounding: on web
 * the last scroll position can be fractional at DPR 2. Lists end FAB_LANE
 * higher, so at the end her lane holds only that padding.
 */
export const END_SLACK = 2;

export type ScrollSample = { y: number; contentHeight: number; viewportHeight: number };
export type TuckState = { tucked: boolean; anchor: number };

/**
 * Her lane is empty at this scroll position: the list is at its end (where it
 * ends FAB_LANE higher, design direction › The lane), or it fits the screen.
 */
export function laneClear(s: ScrollSample): boolean {
  'worklet';
  return s.y >= s.contentHeight - s.viewportHeight - END_SLACK;
}

/**
 * One scroll sample in, the next tuck state out. Pure, so the rule is tested
 * without a list.
 *
 * The lane rule (design direction v2 › The Roxy AI button: "at rest nothing
 * readable or tappable sits in the lane") decides, not the scroll direction:
 * she is out only where her lane is empty (`laneClear`), and rests tucked
 * everywhere else. That is M3's extended FAB collapsing while content scrolls
 * under it; a tap on the tucked O still opens Roxy AI (a collapsed FAB keeps
 * its action), so she stays one tap away. `anchor` is unused (kept so the
 * state shape callers hold does not change).
 */
export function nextTuck(state: TuckState, s: ScrollSample): TuckState {
  'worklet';
  return { tucked: !laneClear(s), anchor: state.anchor };
}

/**
 * The rule with plain arguments (tucked or not), for the UI-thread scroll
 * handler (`useFabScrollHandler`) and the JS one (`onListScroll`) alike.
 */
export function fabScrollStep(y: number, contentHeight: number, viewportHeight: number): boolean {
  'worklet';
  return !laneClear({ y, contentHeight, viewportHeight });
}

/**
 * The UI thread's copy of `tucked` (1 tucked, 0 out). The button's tuck
 * springs from this on the UI thread, so a busy JS thread cannot hold it back
 * once it starts, and a UI-thread scroll handler moves her without a render.
 * The store mirrors into it on every flip (see the subscription below).
 */
export const fabTuck = makeMutable(0);

/**
 * The last scroll sample a list reported. It changes with nearly every scroll
 * event, so it lives here and not in the store: a store write wakes every
 * `useRoxyFab` subscriber, 60 times a second while a list scrolls (jank
 * audit #9). Read back when the list's content grows under her.
 */
let lastSample: ScrollSample | null = null;

interface RoxyFabState {
  /** Roxy AI is switched on. */
  enabled: boolean;
  /** The member whose choice `enabled` holds; null until loaded. */
  loadedFor: string | null;
  /**
   * She rests tucked (off the Feed). Written only when she flips, never per
   * scroll event. Starts true: until a list says her lane is empty, something
   * may sit under her.
   */
  tucked: boolean;
  /**
   * RETIRED (Wave 3, jank audit #9): the anchor moved out of the store (it
   * changed on nearly every scroll event). Kept in the type, always 0, because
   * other lanes' screen tests still seed it with `setState({ anchor: 0 })`.
   * Remove once none does.
   */
  anchor: number;
  /** Read one member's choice from this phone. */
  load: (userId: string) => Promise<void>;
  /** Switch Roxy AI on or off for one member. The screen changes first. */
  setEnabled: (userId: string | null, value: boolean) => Promise<void>;
  /** Feed one scroll sample through `nextTuck`; writes only on a flip. */
  onScrollSample: (sample: ScrollSample) => void;
  /**
   * A new screen (the tabs layout calls this on every route change): forget
   * the last list, so she rests tucked until the new screen's list reports an
   * empty lane. Wave 2 brought her OUT here, over whatever the new screen had
   * at the bottom; the name stays because the layout (lane A) calls it.
   */
  untuck: () => void;
}

export const useRoxyFab = create<RoxyFabState>((set, get) => ({
  enabled: true,
  loadedFor: null,
  tucked: true,
  anchor: 0,

  load: async (userId: string) => {
    let stored: string | null = null;
    try {
      stored = await AsyncStorage.getItem(enabledKeyFor(userId));
    } catch {
      // Storage unreadable: she stays on, the default.
    }
    set({ enabled: stored !== 'off', loadedFor: userId });
  },

  setEnabled: async (userId: string | null, value: boolean) => {
    // `tucked` stays: she returns in the rest state the list on screen calls
    // for (Wave 2 untucked her here, onto Settings' Ghost mode switch).
    set({ enabled: value, ...(userId ? { loadedFor: userId } : {}) });
    if (!userId) return;
    try {
      await AsyncStorage.setItem(enabledKeyFor(userId), value ? 'on' : 'off');
    } catch {
      // The choice holds for this session; nothing to tell her.
    }
  },

  onScrollSample: (sample: ScrollSample) => {
    lastSample = sample;
    const tucked = !laneClear(sample);
    if (tucked !== get().tucked) set({ tucked });
  },

  untuck: () => {
    lastSample = null;
    if (!get().tucked) set({ tucked: true });
  },
}));

// Every flip, from any path (a list, a route change, Settings), reaches the
// UI thread's copy. Flips are rare, so this is not a per-scroll cost. The copy
// starts in step with the store (she starts tucked): a route change to a list
// screen does not flip `tucked`, so a copy left at 0 would keep her out.
fabTuck.value = useRoxyFab.getState().tucked ? 1 : 0;
useRoxyFab.subscribe((state, prev) => {
  if (state.tucked !== prev.tucked) fabTuck.value = state.tucked ? 1 : 0;
});

/** The UI-thread handler's flip, handed back to the store (React reads it). */
function syncTuckedFromUi(tucked: boolean): void {
  if (useRoxyFab.getState().tucked !== tucked) useRoxyFab.setState({ tucked });
}

/**
 * The tuck driven from a UI-thread scroll value: for an `Animated.ScrollView`
 * / `Animated.FlatList` (`onScroll={useFabScrollHandler()}`). The rule runs
 * as a worklet on every frame of the scroll; `fabTuck` flips on the UI thread
 * (the button starts moving in that frame) and the store hears only the flip.
 * Plain lists keep `onListScroll` (JS thread, also flip-only).
 */
export function useFabScrollHandler() {
  return useAnimatedScrollHandler({
    onScroll: (e) => {
      const tucked = fabScrollStep(e.contentOffset.y, e.contentSize.height, e.layoutMeasurement.height);
      if (tucked !== (fabTuck.value === 1)) {
        fabTuck.value = tucked ? 1 : 0;
        runOnJS(syncTuckedFromUi)(tucked);
      }
    },
  });
}

/**
 * Pass straight to a list: `onScroll={onListScroll} scrollEventThrottle={16}`.
 * Stable (module-level), so it never re-renders the list it is passed to.
 */
export function onListScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
  const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
  useRoxyFab.getState().onScrollSample({
    y: contentOffset.y,
    contentHeight: contentSize.height,
    viewportHeight: layoutMeasurement.height,
  });
}

/**
 * Pass to the same list: `onContentSizeChange={onListContentSizeChange}`.
 * When content lands after she came out at the end (Discover's rails on a slow
 * network, a next page), it now reaches into her lane: she tucks. A size change
 * only ever tucks her, never brings her out, because a hidden tab's list may
 * report one while another list is on screen.
 */
export function onListContentSizeChange(_width: number, height: number): void {
  if (!lastSample) return;
  const grown = { ...lastSample, contentHeight: height };
  if (laneClear(grown) || useRoxyFab.getState().tucked) return;
  lastSample = grown;
  useRoxyFab.setState({ tucked: true });
}

/** How often a list reports its scroll to `onListScroll` (ms). */
export const LIST_SCROLL_THROTTLE = 16;

/** The one sentence when she switches Roxy AI off (design direction v2 › Copy voice). */
export const ROXY_OFF_COPY = 'Roxy AI is off. The round button is gone from your screens.';

/**
 * Whether the Roxy AI button shows (the tabs layout's call): the tier has the
 * companion, she has Roxy AI switched on — and that choice is HERS, already
 * loaded (otherwise an "off" would flash the button on at launch) — and the
 * route is not one where she must not sit (`suppressedOn`, the layout's
 * `FAB_SUPPRESSED_ON`: her own chat, Messages, chats, Sister, live rooms).
 */
export function fabVisible(input: {
  pathname: string;
  allowed: boolean;
  enabled: boolean;
  loadedFor: string | null;
  userId: string | null | undefined;
  suppressedOn: readonly string[];
}): boolean {
  const { pathname, allowed, enabled, loadedFor, userId, suppressedOn } = input;
  if (!allowed || !enabled || !userId || loadedFor !== userId) return false;
  return !suppressedOn.some((fragment) => pathname.includes(fragment));
}

/** The Feed is the dark stage: the button wears `brandPink` there. */
export function fabOnStage(pathname: string): boolean {
  return pathname === '/feed' || pathname.startsWith('/feed/');
}
