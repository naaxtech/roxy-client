/**
 * What a profile's Events / Rooms / Games strip is allowed to show.
 *
 * Tabs exist only when there is something to put in them. Creating those
 * things is an official-grant question; displaying them is not. A woman who
 * hosted a night, or an official account with a live room, should not look
 * empty because this route used to hard-code the flags false.
 */

export type HostedCounts = {
  events: number;
  rooms: number;
  games: number;
};

export function hostedTabFlags(counts: HostedCounts): {
  events: boolean;
  rooms: boolean;
  games: boolean;
} {
  return {
    events: counts.events > 0,
    rooms: counts.rooms > 0,
    games: counts.games > 0,
  };
}

export type HostedEvent = {
  id: string;
  title: string;
  starts_at: string;
  event_type: string;
  location_text: string | null;
  status: string;
};

export type HostedGame = {
  id: string;
  name: string;
  short_description: string | null;
  category: string | null;
  url: string | null;
  publisher_type: string | null;
};

export type HostedRoom = {
  id: string;
  name: string;
  status: string;
  room_type: string;
};

export async function loadHostedProfile(
  userId: string,
  officialCommunityId: string | null,
): Promise<{ events: HostedEvent[]; rooms: HostedRoom[]; games: HostedGame[] }> {
  const { supabase } = await import('./supabase');
  const now = new Date().toISOString();
  const [eventsRes, roomsRes, gamesRes] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, starts_at, event_type, location_text, status')
      .eq('host_id', userId)
      .eq('status', 'active')
      .gte('starts_at', now)
      .order('starts_at'),
    officialCommunityId
      ? supabase
        .from('community_rooms')
        .select('id, name, status, room_type')
        .eq('community_id', officialCommunityId)
        .neq('status', 'closed')
        .eq('is_active', true)
        .order('name')
      : Promise.resolve({ data: [] as HostedRoom[], error: null }),
    officialCommunityId
      ? supabase
        .from('community_games')
        .select('games(id, name, short_description, category, url, publisher_type)')
        .eq('community_id', officialCommunityId)
      : Promise.resolve({ data: [] as { games: HostedGame | null }[], error: null }),
  ]);

  return {
    events: (eventsRes.data ?? []) as HostedEvent[],
    rooms: (roomsRes.data ?? []) as HostedRoom[],
    games: ((gamesRes.data ?? []) as { games: HostedGame | null }[])
      .map((row) => row.games)
      .filter((g): g is HostedGame => !!g),
  };
}
