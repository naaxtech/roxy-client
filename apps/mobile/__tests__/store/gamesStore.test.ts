import { useGamesStore } from '../../store/gamesStore';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({
          data: [
            { games: { id: 'g1', name: 'Speed Dating', short_description: 'Speed dates', category: 'dating', publisher_type: 'roxy', url: null, thumbnail_url: null, created_at: '' } },
            { games: { id: 'g2', name: 'WLW Trivia', short_description: 'Trivia', category: 'trivia', publisher_type: 'community', url: 'https://trivia.app', thumbnail_url: null, created_at: '' } },
          ],
          error: null,
        })),
      })),
    })),
  },
}));

describe('gamesStore', () => {
  beforeEach(() => useGamesStore.setState({ games: [], loading: false, communityId: null }));

  it('fetchGames populates games list', async () => {
    await useGamesStore.getState().fetchGames('c1');
    expect(useGamesStore.getState().games).toHaveLength(2);
    expect(useGamesStore.getState().games[0].name).toBe('Speed Dating');
  });

  it('does not re-fetch if same communityId and games exist', async () => {
    await useGamesStore.getState().fetchGames('c1');
    const { supabase } = jest.requireMock('../../lib/supabase');
    const callCount = (supabase.from as jest.Mock).mock.calls.length;
    await useGamesStore.getState().fetchGames('c1');
    expect((supabase.from as jest.Mock).mock.calls.length).toBe(callCount);
  });
});
