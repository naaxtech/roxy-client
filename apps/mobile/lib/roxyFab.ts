import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

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

interface RoxyFabState {
  /** Roxy AI is switched on. */
  enabled: boolean;
  /** The member whose choice `enabled` holds; null until loaded. */
  loadedFor: string | null;
  tucked: boolean;
  anchor: number;
  /** Read one member's choice from this phone. */
  load: (userId: string) => Promise<void>;
  /** Switch Roxy AI on or off for one member. The screen changes first. */
  setEnabled: (userId: string | null, value: boolean) => Promise<void>;
  /** Feed one scroll sample through `nextTuck`. */
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
    const { tucked, anchor } = get();
    const next = nextTuck({ tucked, anchor }, sample);
    if (next.tucked !== tucked || next.anchor !== anchor) set(next);
  },

  untuck: () => {
    if (get().tucked) set({ tucked: false });
  },
}));

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
