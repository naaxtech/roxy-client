import { useGamesStore } from '../../store/gamesStore';

jest.mock('../../lib/supabase', () => {
  const state = {
    communityRows: [] as unknown[],
    gameById: { data: null as unknown, error: null as unknown },
  };
  return {
    __state: state,
    supabase: {
      from: jest.fn((table: string) => {
        if (table === 'games') {
          const chain: Record<string, unknown> = {
            select: jest.fn(() => chain),
            eq: jest.fn(() => chain),
            maybeSingle: jest.fn(() => Promise.resolve(state.gameById)),
          };
          return chain;
        }
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({ data: state.communityRows, error: null })),
          })),
        };
      }),
    },
  };
});

const { supabase, __state } = jest.requireMock('../../lib/supabase');

const communityRows = [
  { games: { id: 'g1', name: 'Speed Dating', short_description: 'Speed dates', category: 'dating', publisher_type: 'roxy', url: null, thumbnail_url: null, created_at: '' } },
  { games: { id: 'g2', name: 'WLW Trivia', short_description: 'Trivia', category: 'trivia', publisher_type: 'community', url: 'https://trivia.app', thumbnail_url: null, created_at: '' } },
];

const singleGame = {
  id: 'g3', name: 'Sapphic Charades', short_description: 'Act it out',
  category: 'party', publisher_type: 'community', url: 'https://charades.app',
  thumbnail_url: null, created_at: '',
};

describe('gamesStore', () => {
  beforeEach(() => {
    useGamesStore.setState({ games: [], loading: false, communityId: null });
    __state.communityRows = communityRows;
    __state.gameById = { data: singleGame, error: null };
    (supabase.from as jest.Mock).mockClear();
  });

  it('fetchGames populates games list', async () => {
    await useGamesStore.getState().fetchGames('c1');
    expect(useGamesStore.getState().games).toHaveLength(2);
    expect(useGamesStore.getState().games[0].name).toBe('Speed Dating');
  });

  it('does not re-fetch if same communityId and games exist', async () => {
    await useGamesStore.getState().fetchGames('c1');
    const callCount = (supabase.from as jest.Mock).mock.calls.length;
    await useGamesStore.getState().fetchGames('c1');
    expect((supabase.from as jest.Mock).mock.calls.length).toBe(callCount);
  });

  // The launch route is reachable by deep link and from the Play tab's own local
  // list, neither of which fills this store — without a by-id read it always
  // rendered "not available", which is half of why community games dead-ended.
  it('fetchGameById loads a game the store has never seen', async () => {
    const game = await useGamesStore.getState().fetchGameById('g3');
    expect(game?.name).toBe('Sapphic Charades');
    expect(useGamesStore.getState().games.map((g) => g.id)).toContain('g3');
  });

  it('fetchGameById serves a cached game without a second query', async () => {
    await useGamesStore.getState().fetchGameById('g3');
    const callCount = (supabase.from as jest.Mock).mock.calls.length;
    const again = await useGamesStore.getState().fetchGameById('g3');
    expect(again?.id).toBe('g3');
    expect((supabase.from as jest.Mock).mock.calls.length).toBe(callCount);
  });

  it('fetchGameById returns null when the row is gone', async () => {
    __state.gameById = { data: null, error: null };
    expect(await useGamesStore.getState().fetchGameById('missing')).toBeNull();
  });
});
