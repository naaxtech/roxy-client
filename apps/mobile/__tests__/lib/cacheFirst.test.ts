import {
  CACHE_MAX_AGE_MS,
  cacheKey,
  clearCache,
  readCache,
  writeCache,
  type CacheStore,
} from '../../lib/cacheFirst';

/**
 * Decision P2 (polish/decisions.md, 2026-10-23): cache-first on cold start for
 * Feed page 1, Discover rails and her own profile only; NEVER Messages. The
 * last-known content paints before the network answers (budget F7), then the
 * network replaces it.
 */
function memoryStore(): CacheStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => { data.set(k, v); },
    removeItem: async (k) => { data.delete(k); },
    getAllKeys: async () => [...data.keys()],
  };
}

describe('cacheFirst', () => {
  it('gives back what was written, for the same member and scope', async () => {
    const store = memoryStore();
    await writeCache('u1', 'discover:events', [{ id: 'e1' }], { store, now: 1000 });
    await expect(readCache('u1', 'discover:events', { store, now: 2000 })).resolves.toEqual([{ id: 'e1' }]);
  });

  it('never shows one member another member\'s cache', async () => {
    const store = memoryStore();
    await writeCache('u1', 'feed:foryou:p1', [{ id: 'p1' }], { store });
    await expect(readCache('u2', 'feed:foryou:p1', { store })).resolves.toBeNull();
  });

  it('keeps nothing without a signed-in member', async () => {
    const store = memoryStore();
    await writeCache(null, 'feed:foryou:p1', [{ id: 'p1' }], { store });
    expect(store.data.size).toBe(0);
    await expect(readCache(undefined, 'feed:foryou:p1', { store })).resolves.toBeNull();
  });

  it('refuses anything from Messages, whatever the caller asks', async () => {
    const store = memoryStore();
    for (const scope of ['messages:inbox', 'chat:abc', 'dm:1', 'inbox'] as never[]) {
      await expect(writeCache('u1', scope, [{ text: 'hi' }], { store })).rejects.toThrow(/never cached/);
    }
    expect(store.data.size).toBe(0);
  });

  it('forgets a copy older than its shelf life', async () => {
    const store = memoryStore();
    await writeCache('u1', 'discover:events', [{ id: 'e1' }], { store, now: 0 });
    await expect(readCache('u1', 'discover:events', { store, now: CACHE_MAX_AGE_MS + 1 })).resolves.toBeNull();
  });

  it('treats an unreadable or foreign entry as a miss, not a crash', async () => {
    const store = memoryStore();
    store.data.set(cacheKey('u1', 'discover:events'), '{not json');
    await expect(readCache('u1', 'discover:events', { store })).resolves.toBeNull();
    store.data.set(cacheKey('u1', 'discover:events'), JSON.stringify({ v: 99, savedAt: 0, value: [] }));
    await expect(readCache('u1', 'discover:events', { store, now: 1 })).resolves.toBeNull();
    const broken: CacheStore = { ...store, getItem: async () => { throw new Error('quota'); } };
    await expect(readCache('u1', 'discover:events', { store: broken })).resolves.toBeNull();
  });

  it('clears one member\'s copies (sign-out) and leaves other keys alone', async () => {
    const store = memoryStore();
    await writeCache('u1', 'discover:events', [1], { store });
    await writeCache('u1', 'feed:foryou:p1', [2], { store });
    await writeCache('u2', 'discover:events', [3], { store });
    store.data.set('theme', 'dark');
    await clearCache('u1', { store });
    expect([...store.data.keys()].sort()).toEqual([cacheKey('u2', 'discover:events'), 'theme'].sort());
  });
});
