import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Game } from '../types';

interface GamesState {
  games: Game[];
  loading: boolean;
  communityId: string | null;
  fetchGames: (communityId: string) => Promise<void>;
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
      .select('games(id, name, short_description, category, publisher_type, url, thumbnail_url, created_at)')
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
}));
