/**
 * What is happening now, in the communities she joined.
 *
 * The 3.0 flattening dissolved Grow, and `HappeningTonightCard` was folded into
 * the feed's Now rail. The fold kept the content and dropped the premise: the
 * card asked for rooms, events and games `.in('community_id', communityIds)`
 * inside a 24-hour window; the rail asked for every live room on Roxy, forever.
 * "Everything live everywhere" and "what my communities are doing tonight" are
 * different products, and only one of them was ever designed.
 *
 * The scope decision, the window and the ordering live here as pure functions
 * so they can be wrong out loud in a test instead of quietly in a query.
 */

export type HappeningItem =
  | { kind: 'room'; id: string; title: string; communityName: string | null; participantCount: number }
  | { kind: 'game'; id: string; title: string; communityName: string | null }
  | { kind: 'event'; id: string; title: string; communityName: string | null; startsAt: string };

export type NowScope =
  | { kind: 'communities'; communityIds: string[] }
  | { kind: 'global' };

/** How far ahead "tonight" reaches. The deleted card's window, unchanged. */
export const NOW_WINDOW_HOURS = 24;

/**
 * Per-kind caps, matching the card this restores (5 rooms, 5 events, 3 games).
 *
 * They are caps on the *merge*, not only on the query, because a flat cap
 * applied after sorting would let twelve live rooms bury the event starting in
 * an hour — and the event is the thing she actually has to decide about.
 */
export const NOW_CAPS = { room: 5, event: 5, game: 3 } as const;
export const MAX_NOW_ITEMS = NOW_CAPS.room + NOW_CAPS.event + NOW_CAPS.game;

/**
 * Whether to narrow to her communities or fall back to everything.
 *
 * A member who has joined nothing is the one who most needs to see that
 * anything is happening at all; scoping her to an empty list would return zero
 * rows and read as a dead app. So zero communities means global, deliberately,
 * and the rail's copy says which one she is looking at.
 */
export function nowScope(communityIds: string[]): NowScope {
  if (communityIds.length === 0) return { kind: 'global' };
  return { kind: 'communities', communityIds };
}

export function happeningWindow(now: Date): { fromISO: string; toISO: string } {
  const to = new Date(now.getTime() + NOW_WINDOW_HOURS * 60 * 60 * 1000);
  return { fromISO: now.toISOString(), toISO: to.toISOString() };
}

/**
 * Live first, soon after.
 *
 * Rooms and games are happening *right now* and she can walk into them; an
 * event is a plan. Within the live block, busier rooms lead — a room with
 * eleven women in it is a different offer from a room with one.
 */
export function mergeHappening(items: HappeningItem[]): HappeningItem[] {
  const rooms = items
    .filter((i): i is Extract<HappeningItem, { kind: 'room' }> => i.kind === 'room')
    .sort((a, b) => b.participantCount - a.participantCount)
    .slice(0, NOW_CAPS.room);

  const games = items
    .filter((i): i is Extract<HappeningItem, { kind: 'game' }> => i.kind === 'game')
    .slice(0, NOW_CAPS.game);

  const events = items
    .filter((i): i is Extract<HappeningItem, { kind: 'event' }> => i.kind === 'event')
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, NOW_CAPS.event);

  return [...rooms, ...games, ...events];
}
