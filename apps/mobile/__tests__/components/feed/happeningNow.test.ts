import {
  nowScope,
  happeningWindow,
  mergeHappening,
  MAX_NOW_ITEMS,
  type HappeningItem,
} from '../../../components/feed/happeningNow';

/**
 * The Now rail's scoping, which is the thing the 3.0 flattening lost.
 *
 * `HappeningTonightCard` asked for rooms, events and games `.in('community_id',
 * communityIds)` inside a 24-hour window — "what is happening tonight, in the
 * communities I joined". The rail that replaced it queried every live room on
 * Roxy with no window at all. The content was reachable; the premise was not.
 *
 * These tests pin the premise: the scope decision, the window, and the order —
 * all three pure, so none of them needs a database to be wrong out loud.
 */

const room = (id: string, participantCount: number): HappeningItem => ({
  kind: 'room', id, title: `room ${id}`, communityName: 'WLW Hikers', participantCount,
});
const game = (id: string): HappeningItem => ({
  kind: 'game', id, title: `game ${id}`, communityName: 'WLW Hikers',
});
const event = (id: string, startsAt: string): HappeningItem => ({
  kind: 'event', id, title: `event ${id}`, communityName: 'WLW Hikers', startsAt,
});

describe('nowScope', () => {
  it('scopes to her communities when she has joined any', () => {
    expect(nowScope(['c1', 'c2'])).toEqual({ kind: 'communities', communityIds: ['c1', 'c2'] });
  });

  it('falls back to global when she has joined none, rather than showing an empty rail', () => {
    // A member who has joined nothing is exactly the member who most needs to
    // see that anything is happening at all. Scoping her to zero communities
    // would return zero rows and read as a dead app.
    expect(nowScope([])).toEqual({ kind: 'global' });
  });
});

describe('happeningWindow', () => {
  it('opens at now and closes 24 hours later', () => {
    const now = new Date('2026-09-01T18:00:00.000Z');
    expect(happeningWindow(now)).toEqual({
      fromISO: '2026-09-01T18:00:00.000Z',
      toISO: '2026-09-02T18:00:00.000Z',
    });
  });
});

describe('mergeHappening', () => {
  it('leads with what is live and ends with what is merely soon', () => {
    const merged = mergeHappening([
      event('e1', '2026-09-01T20:00:00.000Z'),
      room('r1', 3),
      game('g1'),
      room('r2', 11),
    ]);
    expect(merged.map((i) => i.id)).toEqual(['r2', 'r1', 'g1', 'e1']);
  });

  it('orders live rooms by how many women are already in them', () => {
    const merged = mergeHappening([room('quiet', 1), room('busy', 40), room('middling', 9)]);
    expect(merged.map((i) => i.id)).toEqual(['busy', 'middling', 'quiet']);
  });

  it('orders events soonest first', () => {
    const merged = mergeHappening([
      event('later', '2026-09-02T09:00:00.000Z'),
      event('sooner', '2026-09-01T19:30:00.000Z'),
    ]);
    expect(merged.map((i) => i.id)).toEqual(['sooner', 'later']);
  });

  it('caps the rail without letting one kind crowd out the others', () => {
    // Twelve live rooms must not bury the event starting in an hour. A cap
    // applied after a flat sort would do exactly that, so the cap is per kind.
    const rooms = Array.from({ length: 12 }, (_, i) => room(`r${i}`, 100 - i));
    const merged = mergeHappening([...rooms, event('e1', '2026-09-01T19:00:00.000Z'), game('g1')]);

    expect(merged.length).toBeLessThanOrEqual(MAX_NOW_ITEMS);
    expect(merged.map((i) => i.id)).toContain('e1');
    expect(merged.map((i) => i.id)).toContain('g1');
  });

  it('returns nothing for nothing', () => {
    expect(mergeHappening([])).toEqual([]);
  });
});
