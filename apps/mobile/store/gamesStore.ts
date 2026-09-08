import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Game } from '../types';

/** Columns every game read selects — kept in one place so the two queries can't drift. */
const GAME_COLUMNS = 'id, name, short_description, category, publisher_type, url, thumbnail_url, created_at';

interface GamesState {
  games: Game[];
  loading: boolean;
  communityId: string | null;
  fetchGames: (communityId: string) => Promise<void>;
  /**
   * Loads one game by id and caches it. The launch route needs this because it can
   * be reached by deep link or from the Play tab's own local list, neither of which
   * populates `games` for that community.
   */
  fetchGameById: (gameId: string) => Promise<Game | null>;
}

export const useGamesStore = create<GamesState>((set, get) => ({
  games: [],
  loading: false,
  communityId: null,

  fetchGames: async (communityId: string) => {
    if (get().communityId === communityId && get().games.length > 0) return;
    set({ loading: true, communityId });

    const { data, error } = await supabase
      .from('community_games')
      .select(`games(${GAME_COLUMNS})`)
      .eq('community_id', communityId);

    if (!error && data) {
      const games = data
        .map((row: any) => row.games)
        .filter(Boolean) as Game[];
      set({ games, loading: false });
    } else {
      set({ loading: false });
    }
  },

  fetchGameById: async (gameId: string) => {
    const cached = get().games.find((g) => g.id === gameId);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('games')
      .select(GAME_COLUMNS)
      .eq('id', gameId)
      .maybeSingle();

    if (error || !data) return null;

    const game = data as Game;
    set((s) => ({ games: [...s.games.filter((g) => g.id !== game.id), game] }));
    return game;
  },
}));
