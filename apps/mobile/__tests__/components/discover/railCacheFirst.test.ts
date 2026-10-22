import { act, renderHook, waitFor } from '@testing-library/react-native';

/**
 * Decision P2 at the Discover rails (budget F7): on a cold start a rail paints
 * her last-known rows before the network answers, then the network replaces
 * them; a failed refresh keeps what she can already see. Live rooms are never
 * served from the cache — "live" an hour ago is not live.
 */
type Answer = { data: unknown[] | null; error: unknown };
const mockNetwork: { next: Promise<Answer> } = { next: new Promise(() => undefined) };

jest.mock('../../../lib/supabase', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'gte', 'in', 'is', 'not']) c[m] = () => c;
    c.then = (ok: (a: Answer) => unknown, bad: (e: unknown) => unknown) => mockNetwork.next.then(ok, bad);
    return c;
  };
  return { supabase: { from: () => chain() }, callEdgeFunction: jest.fn() };
});
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../../store/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u1' } }) },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGames, useLiveRooms } from '../../../components/discover/useDiscoverData';
import { readCache, writeCache } from '../../../lib/cacheFirst';
import * as cacheFirst from '../../../lib/cacheFirst';

const CACHED = [{ id: 'g-old', name: 'Old game', short_description: '', category: 'x', publisher_type: 'roxy', url: null }];
const FRESH = [{ id: 'g-new', name: 'New game', short_description: '', category: 'x', publisher_type: 'roxy', url: null }];

beforeEach(async () => {
  await AsyncStorage.clear();
  mockNetwork.next = new Promise(() => undefined);
});

describe('Discover rails, cache-first (P2)', () => {
  it('paints her last-known rows while the network is still out', async () => {
    await writeCache('u1', 'discover:games', CACHED);
    const { result } = renderHook(() => useGames());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.rows).toEqual(CACHED);
  });

  it('replaces them with the network rows, and keeps those for next time', async () => {
    await writeCache('u1', 'discover:games', CACHED);
    let answer!: (a: Answer) => void;
    mockNetwork.next = new Promise((r) => { answer = r; });
    const { result } = renderHook(() => useGames());
    await waitFor(() => expect(result.current.rows).toEqual(CACHED));

    await act(async () => { answer({ data: FRESH, error: null }); });
    await waitFor(() => expect(result.current.rows).toEqual(FRESH));
    await expect(readCache('u1', 'discover:games')).resolves.toEqual(FRESH);
  });

  it('keeps what she can see when the refresh fails', async () => {
    await writeCache('u1', 'discover:games', CACHED);
    let answer!: (a: Answer) => void;
    mockNetwork.next = new Promise((r) => { answer = r; });
    const { result } = renderHook(() => useGames());
    await waitFor(() => expect(result.current.rows).toEqual(CACHED));

    await act(async () => { answer({ data: null, error: { message: 'offline' } }); });
    expect(result.current.status).toBe('ready');
    expect(result.current.rows).toEqual(CACHED);
  });

  it('lets a network answer that beats the cache win', async () => {
    await writeCache('u1', 'discover:games', CACHED);
    // The disk is slower than the network this time.
    const slowRead = jest.spyOn(cacheFirst, 'readCache').mockImplementation(
      () => new Promise((r) => setTimeout(() => r(CACHED as never), 20)),
    );
    mockNetwork.next = Promise.resolve({ data: FRESH, error: null });
    const { result } = renderHook(() => useGames());
    await waitFor(() => expect(result.current.rows).toEqual(FRESH));
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(result.current.rows).toEqual(FRESH);
    slowRead.mockRestore();
  });

  it('never serves live rooms from the cache', async () => {
    await AsyncStorage.setItem('roxy.cache.v1:u1:discover:live', JSON.stringify({ v: 1, savedAt: Date.now(), value: [{ id: 'r' }] }));
    const { result } = renderHook(() => useLiveRooms());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.status).toBe('loading');
    expect(result.current.rows).toEqual([]);
  });
});
