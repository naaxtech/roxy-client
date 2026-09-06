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
