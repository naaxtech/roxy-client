/**
 * GAME_ROUTES maps game slug → the Expo Router route to navigate to when
 * the user taps on the game. Add new games here as they are implemented.
 */
export const GAME_ROUTES: Record<string, string> = {
  speed_dating: '/speed-dating',
};

export type GameRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  emoji: string;
  is_active: boolean;
  min_players: number;
  max_players: number;
};
