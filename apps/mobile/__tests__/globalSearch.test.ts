import { globalSearch, searchTerms, MAX_SEARCH_TERMS } from '../lib/globalSearch';

jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const { supabase } = jest.requireMock('../lib/supabase');

type QueryResult = { data: unknown; error: unknown };

/**
 * Chain stub covering the `.ilike()` and `.or()` paths a single table query
 * might use. Self-returning, because a multi-term query chains one filter per
 * term — `.ilike().ilike().limit()` — and a stub that returned a bare `{limit}`
 * could only ever model the single-term case.
 */
type Chain = { limit: jest.Mock; ilike: jest.Mock; or: jest.Mock; eq: jest.Mock };

function chain(result: QueryResult): Chain {
  const c: Chain = {
    limit: jest.fn().mockResolvedValue(result),
    ilike: jest.fn(() => c),
    or: jest.fn(() => c),
    eq: jest.fn(() => c),
  };
  return c;
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
    expect(result).toEqual({ communities: [], people: [], events: [], businesses: [], archive: [] });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('finds archive entries, so a wlw film is searchable by name', async () => {
    // The Archive is a catalogue people look things up in. Leaving it out of
    // global search means the one screen built for "what should I watch" cannot
    // be reached by typing what you want to watch.
    mockTables({
      communities: { data: [], error: null },
      profiles: { data: [], error: null },
      events: { data: [], error: null },
      businesses: { data: [], error: null },
      archive_entries: {
        data: [{
          id: 'a1', slug: 'carol', title: 'Carol', media_type: 'film',
          release_year: 2015, vote_count: 1204, up_count: 1067, has_score: true,
        }],
        error: null,
      },
    });

    const result = await globalSearch('carol');
    expect(result.archive).toEqual([{
      id: 'a1', slug: 'carol', title: 'Carol', media_type: 'film',
      release_year: 2015, vote_count: 1204, up_count: 1067, has_score: true,
    }]);
    expect(supabase.from).toHaveBeenCalledWith('archive_entries');
  });

  it('searches only published archive entries, never a pending submission', async () => {
    const chains = mockTables({
      communities: { data: [], error: null },
      profiles: { data: [], error: null },
      events: { data: [], error: null },
      businesses: { data: [], error: null },
      archive_entries: { data: [], error: null },
    });

    await globalSearch('carol');
    // A member's unreviewed submission is not catalogue yet, and surfacing it
    // in search would publish it ahead of the mod who has to approve it.
    expect(chains.archive_entries.eq).toHaveBeenCalledWith('status', 'published');
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
    // Businesses match on name OR description OR category — one `.or()` group,
    // the same three columns the Build tab's chip search used.
    expect(chains.businesses.or).toHaveBeenCalledWith(
      'name.ilike.%femme%,description.ilike.%femme%,category.ilike.%femme%'
    );
    // People match on display_name OR username via a single `.or()` filter.
    expect(chains.profiles.or).toHaveBeenCalledWith(
      expect.stringContaining('display_name.ilike.%femme%')
    );
    expect(chains.profiles.or).toHaveBeenCalledWith(
      expect.stringContaining('username.ilike.%femme%')
    );
  });

  it('sanitizes commas/parens (PostgREST filter delimiters) and escapes %/_ (ILIKE wildcards) before querying', async () => {
    const chains = mockTables({
      communities: { data: [{ id: 'c1', name: 'Femme Fest', description: null }], error: null },
      profiles: { data: [{ id: 'p1', display_name: 'Jo Anna', username: 'joanna' }], error: null },
      events: { data: [{ id: 'e1', title: 'Femme Fest Mixer', starts_at: '2026-08-01T20:00:00Z' }], error: null },
      businesses: { data: [{ id: 'b1', name: 'Femme Bakery', description: null }], error: null },
    });

    // Contains every dangerous character at once: `,` `(` `)` break PostgREST's
    // `.or()` grammar; `%` `_` are ILIKE wildcards that must be escaped literal.
    const result = await globalSearch('jo,anna%_(test)');

    // `,()` are stripped entirely; `%` and `_` survive but are backslash-escaped.
    const expectedPattern = '%joanna\\%\\_test%';

    expect(chains.communities.ilike).toHaveBeenCalledWith('name', expectedPattern);
    expect(chains.events.ilike).toHaveBeenCalledWith('title', expectedPattern);
    expect(chains.businesses.or).toHaveBeenCalledWith(
      `name.ilike.${expectedPattern},description.ilike.${expectedPattern},category.ilike.${expectedPattern}`
    );
    expect(chains.profiles.or).toHaveBeenCalledWith(
      `display_name.ilike.${expectedPattern},username.ilike.${expectedPattern}`
    );

    // The `.or()` filter string itself must not contain the raw comma/parens
    // that would have corrupted the PostgREST grammar.
    const orArg = (chains.profiles.or as jest.Mock).mock.calls[0][0] as string;
    expect(orArg.match(/[()]/)).toBeNull();
    // Exactly two commas remain — both are the `.or()` clause separator, not
    // input-supplied.
    expect(orArg.split(',').length).toBe(2);

    // Grouped results still come back for every section — sanitizing didn't
    // break the happy path.
    expect(result.communities).toHaveLength(1);
    expect(result.people).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.businesses).toHaveLength(1);
  });
});

/**
 * Multi-term narrowing — the capability `ChipSearchBar` carried out of the Build
 * tab and no surface picked up.
 *
 * Chips accumulated terms and ANDed them, so "vegan" + "bakery" meant a business
 * matching BOTH. `/search`, which is where business lookup lives now, took the
 * whole string as one literal pattern: `%vegan bakery%` matches a business
 * called exactly that and nothing else. Typing two words made results
 * disappear, which reads as "there is nothing here" rather than "I asked wrong".
 */
describe('searchTerms', () => {
  it('splits a phrase into the terms that must all match', () => {
    expect(searchTerms('vegan bakery')).toEqual(['vegan', 'bakery']);
  });

  it('collapses whitespace and drops a term she typed twice', () => {
    expect(searchTerms('  vegan   Bakery  vegan ')).toEqual(['vegan', 'Bakery']);
  });

  it('has no terms for an empty query', () => {
    expect(searchTerms('   ')).toEqual([]);
  });

  it('caps the terms so a pasted paragraph cannot build an unbounded query', () => {
    expect(searchTerms('a b c d e f g h')).toHaveLength(MAX_SEARCH_TERMS);
  });
});

describe('globalSearch across several terms', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires every term to match, one filter per term', async () => {
    const chains = mockTables({
      communities: { data: [], error: null },
      profiles: { data: [], error: null },
      events: { data: [], error: null },
      businesses: { data: [], error: null },
    });

    await globalSearch('vegan bakery');

    expect(chains.communities.ilike).toHaveBeenCalledWith('name', '%vegan%');
    expect(chains.communities.ilike).toHaveBeenCalledWith('name', '%bakery%');
    expect(chains.communities.ilike).toHaveBeenCalledTimes(2);

    expect(chains.events.ilike).toHaveBeenCalledWith('title', '%vegan%');
    expect(chains.events.ilike).toHaveBeenCalledWith('title', '%bakery%');

    expect(chains.profiles.or).toHaveBeenCalledTimes(2);
    expect(chains.businesses.or).toHaveBeenCalledTimes(2);
  });

  it('matches a business on name, description or category — the columns the chips searched', async () => {
    const chains = mockTables({
      communities: { data: [], error: null },
      profiles: { data: [], error: null },
      events: { data: [], error: null },
      businesses: { data: [], error: null },
    });

    await globalSearch('vegan');

    expect(chains.businesses.or).toHaveBeenCalledWith(
      'name.ilike.%vegan%,description.ilike.%vegan%,category.ilike.%vegan%'
    );
  });

  it('sanitizes each term separately, so one bad character cannot escape its clause', async () => {
    const chains = mockTables({
      communities: { data: [], error: null },
      profiles: { data: [], error: null },
      events: { data: [], error: null },
      businesses: { data: [], error: null },
    });

    await globalSearch('jo,anna 100%');

    // The comma is stripped inside its own term rather than being read as the
    // separator between two clauses.
    expect(chains.communities.ilike).toHaveBeenCalledWith('name', '%joanna%');
    expect(chains.communities.ilike).toHaveBeenCalledWith('name', '%100\\%%');
  });
});
