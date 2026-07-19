import { globalSearch } from '../lib/globalSearch';

jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const { supabase } = jest.requireMock('../lib/supabase');

type QueryResult = { data: unknown; error: unknown };

/** Chain stub covering both the `.ilike().limit()` and `.or().limit()` paths a single table query might use. */
function chain(result: QueryResult) {
  const limit = jest.fn().mockResolvedValue(result);
  const ilike = jest.fn(() => ({ limit }));
  const or = jest.fn(() => ({ limit }));
  return { ilike, or, limit };
}

function mockTables(byTable: Record<string, QueryResult>) {
  const chains: Record<string, ReturnType<typeof chain>> = {};
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    const c = chains[table] ?? (chains[table] = chain(byTable[table] ?? { data: [], error: null }));
    return { select: jest.fn(() => c) };
  });
  return chains;
}

describe('globalSearch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns safe-empty results for a blank query without touching supabase', async () => {
    const result = await globalSearch('   ');
    expect(result).toEqual({ communities: [], people: [], events: [], businesses: [] });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('fans out to all four tables and returns their rows', async () => {
    mockTables({
      communities: { data: [{ id: 'c1', name: 'Femme Fest', description: 'A community' }], error: null },
      profiles: { data: [{ id: 'p1', display_name: 'Ari', username: 'ari' }], error: null },
      events: { data: [{ id: 'e1', title: 'Femme Fest Mixer', starts_at: '2026-08-01T20:00:00Z' }], error: null },
      businesses: { data: [{ id: 'b1', name: 'Femme Bakery', description: 'Queer-owned' }], error: null },
    });

    const result = await globalSearch('femme');

    expect(result.communities).toEqual([{ id: 'c1', name: 'Femme Fest', description: 'A community' }]);
    expect(result.people).toEqual([{ id: 'p1', display_name: 'Ari', username: 'ari' }]);
    expect(result.events).toEqual([{ id: 'e1', title: 'Femme Fest Mixer', starts_at: '2026-08-01T20:00:00Z' }]);
    expect(result.businesses).toEqual([{ id: 'b1', name: 'Femme Bakery', description: 'Queer-owned' }]);
    expect(supabase.from).toHaveBeenCalledWith('communities');
    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(supabase.from).toHaveBeenCalledWith('events');
    expect(supabase.from).toHaveBeenCalledWith('businesses');
  });

  it('returns an empty array for a table whose query errors, without failing the others', async () => {
    mockTables({
      communities: { data: null, error: new Error('rls denied') },
      profiles: { data: [{ id: 'p1', display_name: 'Ari', username: 'ari' }], error: null },
      events: { data: null, error: null },
      businesses: { data: null, error: null },
    });

    const result = await globalSearch('ari');

    expect(result.communities).toEqual([]);
    expect(result.people).toEqual([{ id: 'p1', display_name: 'Ari', username: 'ari' }]);
    expect(result.events).toEqual([]);
    expect(result.businesses).toEqual([]);
  });

  it('returns safe-empty for a table whose query rejects outright', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => ({
      select: jest.fn(() => {
        if (table === 'events') {
          const rejectingLimit = jest.fn().mockRejectedValue(new Error('network down'));
          return {
            ilike: jest.fn(() => ({ limit: rejectingLimit })),
            or: jest.fn(() => ({ limit: rejectingLimit })),
          };
        }
        return chain({ data: [], error: null });
      }),
    }));

    const result = await globalSearch('femme');
    expect(result.events).toEqual([]);
    expect(result.communities).toEqual([]);
  });

  it('trims the query, wraps it in ILIKE wildcards, and limits each table to 5', async () => {
    const chains = mockTables({
      communities: { data: [], error: null },
      profiles: { data: [], error: null },
      events: { data: [], error: null },
      businesses: { data: [], error: null },
    });

    await globalSearch('  femme  ');

    expect(chains.communities.ilike).toHaveBeenCalledWith('name', '%femme%');
    expect(chains.communities.limit).toHaveBeenCalledWith(5);
    expect(chains.events.ilike).toHaveBeenCalledWith('title', '%femme%');
    expect(chains.businesses.ilike).toHaveBeenCalledWith('name', '%femme%');
    // People match on display_name OR username via a single `.or()` filter.
    expect(chains.profiles.or).toHaveBeenCalledWith(
      expect.stringContaining('display_name.ilike.%femme%')
    );
    expect(chains.profiles.or).toHaveBeenCalledWith(
      expect.stringContaining('username.ilike.%femme%')
    );
  });
});
