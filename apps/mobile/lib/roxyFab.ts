import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { makeMutable, runOnJS, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

/**
 * The Roxy AI button's state (design direction v2 › The Roxy AI button).
 *
 * Three things live here, and nowhere else:
 *  - **enabled**: whether Roxy AI is switched on (Settings › Roxy AI, M173).
 *    Kept on this phone PER MEMBER (`roxy_ai_enabled_v1:<userId>`), so a second
 *    account signing in on the same phone starts with her on, not with the
 *    last member's choice. Default: on. Optimistic: the button leaves the
 *    screen before storage answers.
 *  - **tucked**: whether she is tucked into the screen edge because a list is
 *    scrolling down (M3's extended-FAB behaviour, made Roxy's).
 *  - **onListScroll**: a plain `onScroll` handler any list passes straight in
 *    (`onScroll={onListScroll} scrollEventThrottle={16}`). Not the Feed pager:
 *    on the Feed she never tucks.
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

/**
 * How far (dp) a list must travel one way before she tucks or comes back.
 * Small enough to answer a flick, big enough to ignore a resting thumb.
 */
export const TUCK_THRESHOLD = 12;

/** Within this many dp of the top or the end of a list she stays out. */
export const EDGE_ZONE = 24;

export type ScrollSample = { y: number; contentHeight: number; viewportHeight: number };
export type TuckState = { tucked: boolean; anchor: number };

/**
 * One scroll sample in, the next tuck state out. Pure, so the rule is tested
 * without a list.
 *
 * Hysteresis by anchor: while she is out, the anchor follows the list's
 * highest point; travelling more than `TUCK_THRESHOLD` below it tucks her.
 * While tucked, the anchor follows the lowest point; travelling back up more
 * than the threshold brings her out. At the top, or at the end of the list
 * (where her lane is empty by design), she is always out.
 */
export function nextTuck(state: TuckState, s: ScrollSample): TuckState {
  'worklet';
  const end = s.contentHeight - s.viewportHeight;
  const atTop = s.y <= EDGE_ZONE;
  const atEnd = s.y >= end - EDGE_ZONE;
  if (atTop || atEnd) return { tucked: false, anchor: s.y };

  if (state.tucked) {
    if (s.y > state.anchor) return { tucked: true, anchor: s.y };
    if (state.anchor - s.y > TUCK_THRESHOLD) return { tucked: false, anchor: s.y };
    return state;
  }
  if (s.y < state.anchor) return { tucked: false, anchor: s.y };
  if (s.y - state.anchor > TUCK_THRESHOLD) return { tucked: true, anchor: s.y };
  return state;
}

/**
 * `nextTuck` with plain arguments, for the UI-thread scroll handler
 * (`useFabScrollHandler`) and the JS one (`onListScroll`) alike.
 */
export function fabScrollStep(
  tucked: boolean,
  anchor: number,
  y: number,
  contentHeight: number,
  viewportHeight: number,
): TuckState {
  'worklet';
  return nextTuck({ tucked, anchor }, { y, contentHeight, viewportHeight });
}

/**
 * The UI thread's copy of `tucked` (1 tucked, 0 out). The button's tuck
 * springs from this on the UI thread, so a busy JS thread cannot hold it back
 * once it starts, and a UI-thread scroll handler moves her without a render.
 * The store mirrors into it on every flip (see the subscription below).
 */
export const fabTuck = makeMutable(0);

/**
 * The JS handler's anchor. It moves with nearly every scroll sample, so it
 * lives here and not in the store: a store write wakes every `useRoxyFab`
 * subscriber, 60 times a second while a list scrolls (jank audit #9).
 */
let jsAnchor = 0;

interface RoxyFabState {
  /** Roxy AI is switched on. */
  enabled: boolean;
  /** The member whose choice `enabled` holds; null until loaded. */
  loadedFor: string | null;
  /** She is tucked. Written only when she flips, never per scroll event. */
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
  /** Bring her back at once: a tap on the tucked button, a new screen. */
  untuck: () => void;
}

export const useRoxyFab = create<RoxyFabState>((set, get) => ({
  enabled: true,
  loadedFor: null,
  tucked: false,
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
    set({ enabled: value, tucked: false, ...(userId ? { loadedFor: userId } : {}) });
    if (!userId) return;
    try {
      await AsyncStorage.setItem(enabledKeyFor(userId), value ? 'on' : 'off');
    } catch {
      // The choice holds for this session; nothing to tell her.
    }
  },

  onScrollSample: (sample: ScrollSample) => {
    const { tucked } = get();
    const next = nextTuck({ tucked, anchor: jsAnchor }, sample);
    jsAnchor = next.anchor;
    if (next.tucked !== tucked) set({ tucked: next.tucked });
  },

  untuck: () => {
    if (get().tucked) set({ tucked: false });
  },
}));

// Every flip, from any path (a list, a route change, Settings), reaches the
// UI thread's copy. Flips are rare, so this is not a per-scroll cost.
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
  const anchor = useSharedValue(0);
  return useAnimatedScrollHandler({
    onScroll: (e) => {
      const tucked = fabTuck.value === 1;
      const next = fabScrollStep(
        tucked, anchor.value, e.contentOffset.y, e.contentSize.height, e.layoutMeasurement.height,
      );
      anchor.value = next.anchor;
      if (next.tucked !== tucked) {
        fabTuck.value = next.tucked ? 1 : 0;
        runOnJS(syncTuckedFromUi)(next.tucked);
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
