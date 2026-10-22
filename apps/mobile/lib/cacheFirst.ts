import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Cache-first on cold start (decision P2, polish/decisions.md 2026-10-23;
 * budget F7): the last-known Feed page 1, Discover rails and her own profile
 * paint before the network answers, then the network replaces them.
 *
 * Privacy rails, enforced here rather than trusted to callers:
 *  - only the scopes P2 names can be written (`CacheScope`); anything that
 *    smells of Messages (messages, chat, dm, inbox) throws — names, previews and
 *    message text never touch the disk (discreet mode, a borrowed phone);
 *  - every entry is keyed by her member id, so another member signing in on
 *    the same device reads nothing of hers; nothing is kept signed out;
 *  - `clearCache(userId)` removes her copies (call it on sign-out);
 *  - a copy older than `CACHE_MAX_AGE_MS` is a miss.
 * A read never throws: an unreadable, foreign or stale entry is a miss.
 */

export interface CacheStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys?(): Promise<readonly string[]>;
}

/** What P2 allows on disk: Feed page 1, a Discover rail, her own profile. */
export type CacheScope = 'feed:foryou:p1' | 'profile:self' | `discover:${string}`;

/** A day: yesterday's rails are still a better first frame than grey shapes. */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const PREFIX = 'roxy.cache.v1:';
const VERSION = 1;
const NEVER = /message|chat|\bdm\b|^dm:|inbox/i;

type Opts = { store?: CacheStore; now?: number };

export function cacheKey(userId: string, scope: CacheScope): string {
  return `${PREFIX}${userId}:${scope}`;
}

function assertCacheable(scope: string): void {
  const allowed = scope === 'feed:foryou:p1' || scope === 'profile:self' || scope.startsWith('discover:');
  if (!allowed || NEVER.test(scope)) {
    throw new Error(`cacheFirst: "${scope}" is never cached (P2: Feed page 1, Discover rails, her own profile only)`);
  }
}

const defaultStore = (): CacheStore => AsyncStorage as unknown as CacheStore;

/** Her last-known copy of `scope`, or null (no member, a miss, too old, unreadable). */
export async function readCache<T>(
  userId: string | null | undefined,
  scope: CacheScope,
  opts: Opts = {},
): Promise<T | null> {
  if (!userId) return null;
  try {
    assertCacheable(scope);
    const raw = await (opts.store ?? defaultStore()).getItem(cacheKey(userId, scope));
    if (!raw) return null;
    const entry = JSON.parse(raw) as { v?: number; savedAt?: number; value?: T };
    if (entry.v !== VERSION || typeof entry.savedAt !== 'number' || entry.value === undefined) return null;
    if ((opts.now ?? Date.now()) - entry.savedAt > CACHE_MAX_AGE_MS) return null;
    return entry.value;
  } catch {
    return null;
  }
}

/**
 * Keeps `value` as her last-known copy of `scope`. Throws for a scope P2 does
 * not allow (a programming error); a storage failure is ignored.
 */
export async function writeCache<T>(
  userId: string | null | undefined,
  scope: CacheScope,
  value: T,
  opts: Opts = {},
): Promise<void> {
  assertCacheable(scope);
  if (!userId) return;
  try {
    await (opts.store ?? defaultStore()).setItem(
      cacheKey(userId, scope),
      JSON.stringify({ v: VERSION, savedAt: opts.now ?? Date.now(), value }),
    );
  } catch {
    // Full or unavailable storage: the next cold start simply waits for the network.
  }
}

/** Removes every cached copy of hers (sign-out). Other keys are untouched. */
export async function clearCache(userId: string, opts: Opts = {}): Promise<void> {
  const store = opts.store ?? defaultStore();
  try {
    const keys = (await store.getAllKeys?.()) ?? [];
    const mine = keys.filter((k) => k.startsWith(`${PREFIX}${userId}:`));
    await Promise.all(mine.map((k) => store.removeItem(k)));
  } catch {
    // Nothing more to do; entries also expire after CACHE_MAX_AGE_MS.
  }
}
