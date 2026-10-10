import type { StoreApi, UseBoundStore } from 'zustand';
import { useArchiveStore } from './archiveStore';
import { useAuthStore } from './authStore';
import { useBuildStore } from './buildStore';
import { useCelebrationStore } from './celebrationStore';
import { useCommunityFilterStore } from './communityFilterStore';
import { useCommunityStore } from './communityStore';
import { useConnectStore } from './connectStore';
import { useFeedbackStore } from './feedbackStore';
import { useFeedStore } from './feedStore';
import { useFollowStore } from './followStore';
import { useFriendStore } from './friendStore';
import { useGamesStore } from './gamesStore';
import { useGateStore } from './gateStore';
import { useMarketplaceStore } from './marketplaceStore';
import { useProfileStore } from './profileStore';
import { useRoxyChatStore } from './roxyChatStore';
import { useSafetyStore } from './safetyStore';
// useThemeStore is DEVICE-level (see DEVICE_STORES): named, deliberately not imported.
import { useViewAsStore } from './viewAsStore';

/**
 * Sign-out hygiene (ARC-08).
 *
 * The defect: sign out as one member, sign in as another on the same phone,
 * and the second one sees the first one's Archive votes and watchlist, liked
 * and saved posts, follows, blocked list, cart, conversations — every zustand
 * store outlived the session because only auth, profile, view-as and gate were
 * cleared. On a shared or handed-down phone that is a privacy leak, and for a
 * woman who is not out it is an outing.
 *
 * Every store under store/ is registered here, either as PER_USER (reset to its
 * initial state on sign-out) or DEVICE (kept, with the reason). The test
 * (__tests__/store/resetAllStores.test.ts) reads store/ from disk and fails when
 * a store is in neither list, so a new store cannot be forgotten.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStore = UseBoundStore<StoreApi<any>>;

export const PER_USER_STORES: Record<string, AnyStore> = {
  useArchiveStore,
  useAuthStore,
  useBuildStore,
  useCelebrationStore,
  useCommunityFilterStore,
  useCommunityStore,
  useConnectStore,
  useFeedbackStore,
  useFeedStore,
  useFollowStore,
  useFriendStore,
  useGamesStore,
  useGateStore,
  useMarketplaceStore,
  useProfileStore,
  useRoxyChatStore,
  useSafetyStore,
  useViewAsStore,
};

export const DEVICE_STORES: Record<string, string> = {
  useThemeStore:
    'The light/dark choice belongs to the phone and is re-read from her profile on the next sign-in; ' +
    'wiping it would flash the wrong theme on the sign-in screen.',
};

/**
 * A fresh copy of a store's initial value. Sets, Maps, arrays and plain objects
 * are copied so a later in-place mutation can never write into the initial
 * state that the next reset hands out.
 */
function freshCopy(initial: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(initial)) {
    if (v instanceof Set) out[k] = new Set(v);
    else if (v instanceof Map) out[k] = new Map(v);
    else if (Array.isArray(v)) out[k] = [...v];
    else if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) out[k] = { ...v };
    else out[k] = v;
  }
  return out;
}

/** Stores whose "signed out" state is not their boot state. */
const SIGNED_OUT_STATE: Partial<Record<string, () => void>> = {
  // The boot state is `loading: true` (waiting for the persisted session); a
  // signed-out phone is not loading anything, so use the store's own signOut.
  useAuthStore: () => useAuthStore.getState().signOut(),
};

export type ResetOptions = {
  /**
   * Keep the gate (invite code + application in progress). The sign-up error
   * paths sign the half-made session out but she is still mid-application;
   * wiping the gate there would throw away the code she just typed.
   */
  keepGate?: boolean;
};

/** Reset every per-user store. Never throws: one broken store must not leave the rest of her data behind. */
export function resetAllStores(opts: ResetOptions = {}): void {
  for (const [name, store] of Object.entries(PER_USER_STORES)) {
    if (opts.keepGate && name === 'useGateStore') continue;
    try {
      const custom = SIGNED_OUT_STATE[name];
      if (custom) custom();
      else store.setState(freshCopy(store.getInitialState() as Record<string, unknown>), true);
    } catch (e) {
      if (__DEV__) console.warn(`[resetAllStores] ${name} did not reset`, e);
    }
  }
}
