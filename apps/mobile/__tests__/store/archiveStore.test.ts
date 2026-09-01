jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getSession: jest.fn() },
  },
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/archive', () => ({
  fetchArchiveEntries: jest.fn(),
}));

import { act, renderHook } from '@testing-library/react-native';
import { useArchiveStore } from '../../store/archiveStore';
import type { ArchiveEntry } from '../../lib/archive';

const { supabase } = jest.requireMock('../../lib/supabase');
const { logError } = jest.requireMock('../../lib/errorLogger');
const { fetchArchiveEntries } = jest.requireMock('../../lib/archive');

type Result = { data?: unknown; error?: unknown; count?: number | null };

/**
 * Chainable PostgREST stub, awaitable at any point in the chain — same shape
 * as the helper in marketplaceStore's own tests. `.then` resolves the whole
 * chain so `await supabase.from(x).upsert(y)` (no trailing `.select()`) works
 * exactly like `await supabase.from(x).upsert(y).select().maybeSingle()`.
 */
function makeChain(result: Result) {
  const chain: Record<string, unknown> = {};
  const passthrough = ['select', 'eq', 'upsert', 'insert', 'delete', 'order', 'limit'];
  passthrough.forEach((m) => {
    chain[m] = jest.fn(() => chain);
  });
  (chain as any).maybeSingle = jest.fn(() => Promise.resolve(result));
  (chain as any).then = (
    resolve: (v: Result) => unknown,
    reject?: (e: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const signedIn = (userId = 'user-1') =>
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: userId } } } });

const signedOut = () => supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

const makeEntry = (id: string, overrides: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  id,
  slug: `slug-${id}`,
  title: `Title ${id}`,
  media_type: 'film',
  release_year: 2020,
  creator: null,
  length_label: null,
  summary: null,
  cover_url: null,
  cover_gradient: null,
  vote_count: 0,
  up_count: 0,
  review_count: 0,
  has_score: false,
  published_at: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  useArchiveStore.setState({
    entries: [],
    loading: false,
    error: null,
    filters: { query: '', mediaType: null, sort: 'top' },
    myVotes: {},
    watchlist: [],
    noteAgreements: [],
  });
  signedIn();
});

describe('archiveStore.load', () => {
  it('populates entries from fetchArchiveEntries using the current filters', async () => {
    fetchArchiveEntries.mockResolvedValue([makeEntry('e1'), makeEntry('e2')]);
    useArchiveStore.setState({ filters: { query: 'star', mediaType: 'film', sort: 'newest' } });

    const { result } = renderHook(() => useArchiveStore());
    await act(async () => {
      await result.current.load();
    });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetchArchiveEntries).toHaveBeenCalledWith({ query: 'star', mediaType: 'film', sort: 'newest' });
  });

  it('sets a friendly error and clears loading on failure, without double-logging', async () => {
    fetchArchiveEntries.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useArchiveStore());
    await act(async () => {
      await result.current.load();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(result.current.entries).toEqual([]);
    // fetchArchiveEntries (lib/archive.ts) already logs the underlying error
    // before throwing — load() must not log it a second time.
    expect(logError).not.toHaveBeenCalled();
  });
});

describe('archiveStore.setFilters', () => {
  it('merges a patch without clobbering the rest of the filters', () => {
    const { result } = renderHook(() => useArchiveStore());
    act(() => {
      result.current.setFilters({ query: 'wlw' });
    });
    expect(result.current.filters).toEqual({ query: 'wlw', mediaType: null, sort: 'top' });

    act(() => {
      result.current.setFilters({ mediaType: 'book' });
    });
    expect(result.current.filters).toEqual({ query: 'wlw', mediaType: 'book', sort: 'top' });
  });
});

describe('archiveStore.hydrateMine', () => {
  it('populates myVotes, watchlist, and noteAgreements from the three tables', async () => {
    supabase.from.mockImplementation((table: string) => {
      if (table === 'archive_votes') {
        return makeChain({ data: [{ entry_id: 'e1', value: true }, { entry_id: 'e2', value: false }], error: null });
      }
      if (table === 'archive_watchlist') {
        return makeChain({ data: [{ entry_id: 'e3' }], error: null });
      }
      return makeChain({ data: [{ note_id: 'n1' }], error: null });
    });

    const { result } = renderHook(() => useArchiveStore());
    await act(async () => {
      await result.current.hydrateMine('user-1');
    });

    expect(result.current.myVotes).toEqual({ e1: true, e2: false });
    expect(result.current.watchlist).toEqual(['e3']);
    expect(result.current.noteAgreements).toEqual(['n1']);
  });

  it('keeps existing votes when the votes query fails — a failed refresh must never look like "you voted on nothing"', async () => {
    useArchiveStore.setState({ myVotes: { e9: true } });
    supabase.from.mockImplementation((table: string) => {
      if (table === 'archive_votes') return makeChain({ data: null, error: { message: 'boom' } });
      return makeChain({ data: [], error: null });
    });

    const { result } = renderHook(() => useArchiveStore());
    await act(async () => {
      await result.current.hydrateMine('user-1');
    });

    expect(result.current.myVotes).toEqual({ e9: true });
    expect(logError).toHaveBeenCalled();
  });
});

describe('archiveStore.vote', () => {
  it('applies optimistically before the write resolves', () => {
    supabase.from.mockReturnValue(makeChain({ data: { value: true }, error: null }));

    const { result } = renderHook(() => useArchiveStore());
    act(() => {
      void result.current.vote('e1', true);
    });

    expect(result.current.myVotes['e1']).toBe(true);
  });

  it('keeps the vote when the write is confirmed', async () => {
    supabase.from.mockReturnValue(makeChain({ data: { value: true }, error: null }));

    const { result } = renderHook(() => useArchiveStore());
    await act(async () => {
      await result.current.vote('e1', true);
    });

    expect(result.current.myVotes['e1']).toBe(true);
  });

  it('rolls back to the previous vote on a DB error', async () => {
    useArchiveStore.setState({ myVotes: { e1: false } });
    supabase.from.mockReturnValue(makeChain({ data: null, error: { message: 'db error' } }));

    const { result } = renderHook(() => useArchiveStore());
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.vote('e1', true);
      } catch (e) {
        thrown = e;
      }
    });

    expect(thrown).toBeDefined();
    expect(result.current.myVotes['e1']).toBe(false);
  });

  it('clears the key entirely on rollback when she had never voted before (absent, not false)', async () => {
    supabase.from.mockReturnValue(makeChain({ data: null, error: { message: 'db error' } }));

    const { result } = renderHook(() => useArchiveStore());
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.vote('e1', true);
      } catch (e) {
        thrown = e;
      }
    });

    expect(thrown).toBeDefined();
    expect(result.current.myVotes['e1']).toBeUndefined();
    expect('e1' in result.current.myVotes).toBe(false);
  });

  it('rolls back on a 200-with-zero-rows response — "no error" is not "it happened"', async () => {
    useArchiveStore.setState({ myVotes: { e1: false } });
    supabase.from.mockReturnValue(makeChain({ data: null, error: null }));

    const { result } = renderHook(() => useArchiveStore());
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.vote('e1', true);
      } catch (e) {
        thrown = e;
      }
    });

    expect(thrown).toBeDefined();
    expect(result.current.myVotes['e1']).toBe(false);
  });

  it('rolls back and throws when there is no session', async () => {
    useArchiveStore.setState({ myVotes: { e1: false } });
    signedOut();

    const { result } = renderHook(() => useArchiveStore());
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.vote('e1', true);
      } catch (e) {
        thrown = e;
      }
    });

    expect(thrown).toBeDefined();
    expect(result.current.myVotes['e1']).toBe(false);
  });
});

describe('archiveStore.toggleWatch', () => {
  it('optimistically adds to the watchlist and keeps it on success', async () => {
    supabase.from.mockReturnValue(makeChain({ data: null, error: null }));

    const { result } = renderHook(() => useArchiveStore());
    await act(async () => {
      await result.current.toggleWatch('e1');
    });

    expect(result.current.watchlist).toEqual(['e1']);
  });

  it('rolls back an add when the write fails', async () => {
    supabase.from.mockReturnValue(makeChain({ data: null, error: { message: 'db error' } }));

    const { result } = renderHook(() => useArchiveStore());
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.toggleWatch('e1');
      } catch (e) {
        thrown = e;
      }
    });

    expect(thrown).toBeDefined();
    expect(result.current.watchlist).toEqual([]);
  });

  it('removes from the watchlist when the delete confirms count: 1', async () => {
    useArchiveStore.setState({ watchlist: ['e1', 'e2'] });
    supabase.from.mockReturnValue(makeChain({ data: null, error: null, count: 1 }));

    const { result } = renderHook(() => useArchiveStore());
    await act(async () => {
      await result.current.toggleWatch('e1');
    });

    expect(result.current.watchlist).toEqual(['e2']);
  });

  it('rolls back a remove on a 200-with-zero-count delete — the exact trap block_user shipped', async () => {
    useArchiveStore.setState({ watchlist: ['e1', 'e2'] });
    supabase.from.mockReturnValue(makeChain({ data: null, error: null, count: 0 }));

    const { result } = renderHook(() => useArchiveStore());
    // The rejection is caught INSIDE act so React still flushes the
    // rollback before we read result.current. Letting act() itself
    // reject skips that flush and the assertion reads stale state —
    // which looks exactly like a rollback that never happened.
    let threw = false;
    await act(async () => {
      try { await result.current.toggleWatch('e1'); } catch { threw = true; }
    });
    expect(threw).toBe(true);

    expect(result.current.watchlist).toEqual(['e1', 'e2']);
  });

  it('rolls back a remove on a DB error', async () => {
    useArchiveStore.setState({ watchlist: ['e1'] });
    supabase.from.mockReturnValue(makeChain({ data: null, error: { message: 'db error' }, count: null }));

    const { result } = renderHook(() => useArchiveStore());
    // The rejection is caught INSIDE act so React still flushes the
    // rollback before we read result.current. Letting act() itself
    // reject skips that flush and the assertion reads stale state —
    // which looks exactly like a rollback that never happened.
    let threw = false;
    await act(async () => {
      try { await result.current.toggleWatch('e1'); } catch { threw = true; }
    });
    expect(threw).toBe(true);

    expect(result.current.watchlist).toEqual(['e1']);
  });
});

describe('archiveStore.agreeNote', () => {
  it('adds the note id on a confirmed write', async () => {
    supabase.from.mockReturnValue(makeChain({ data: { note_id: 'n1' }, error: null }));

    const { result } = renderHook(() => useArchiveStore());
    await act(async () => {
      await result.current.agreeNote('n1');
    });

    expect(result.current.noteAgreements).toEqual(['n1']);
  });

  it('is a no-op that never calls the DB when already agreed locally', async () => {
    useArchiveStore.setState({ noteAgreements: ['n1'] });

    const { result } = renderHook(() => useArchiveStore());
    await act(async () => {
      await result.current.agreeNote('n1');
    });

    expect(result.current.noteAgreements).toEqual(['n1']);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('rolls back and throws a real, specific error when RLS refuses a pending member (42501) — never a silent no-op', async () => {
    supabase.from.mockReturnValue(makeChain({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } }));

    const { result } = renderHook(() => useArchiveStore());
    let thrown: Error | undefined;
    await act(async () => {
      try {
        await result.current.agreeNote('n1');
      } catch (e) {
        thrown = e as Error;
      }
    });

    expect(thrown).toBeDefined();
    expect(thrown?.message).toMatch(/approved member/i);
    expect(result.current.noteAgreements).toEqual([]);
  });

  it('treats a duplicate-key response (23505) as already-true, not a failure to roll back', async () => {
    supabase.from.mockReturnValue(makeChain({ data: null, error: { message: 'duplicate key', code: '23505' } }));

    const { result } = renderHook(() => useArchiveStore());
    await act(async () => {
      await result.current.agreeNote('n1');
    });

    expect(result.current.noteAgreements).toEqual(['n1']);
  });

  it('rolls back on a 200-with-zero-rows response', async () => {
    supabase.from.mockReturnValue(makeChain({ data: null, error: null }));

    const { result } = renderHook(() => useArchiveStore());
    // The rejection is caught INSIDE act so React still flushes the
    // rollback before we read result.current. Letting act() itself
    // reject skips that flush and the assertion reads stale state —
    // which looks exactly like a rollback that never happened.
    let threw = false;
    await act(async () => {
      try { await result.current.agreeNote('n1'); } catch { threw = true; }
    });
    expect(threw).toBe(true);

    expect(result.current.noteAgreements).toEqual([]);
  });
});
