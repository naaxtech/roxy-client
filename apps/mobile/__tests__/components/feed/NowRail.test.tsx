import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { NowRail } from '../../../components/feed/NowRail';

/**
 * The rail must ask for HER communities, and must ask all three tables.
 *
 * Every assertion here fails against the version of `NowRail` that shipped with
 * the flattening: it queried `community_rooms` alone, Roxy-wide, with no time
 * window — so the events and games that `HappeningTonightCard` used to surface
 * had no route to the surface that replaced it.
 */

type Rec = { table: string; ops: [string, unknown[]][] };
let mockCalls: Rec[] = [];
let mockTableData: Record<string, unknown[]> = {};
let mockTableError: Record<string, { message: string } | null> = {};

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const rec: Rec = { table, ops: [] };
      mockCalls.push(rec);
      const chain: Record<string, unknown> = {};
      ['select', 'in', 'eq', 'gte', 'lte', 'order'].forEach((m) => {
        chain[m] = (...args: unknown[]) => { rec.ops.push([m, args]); return chain; };
      });
      chain.limit = (...args: unknown[]) => {
        rec.ops.push(['limit', args]);
        return Promise.resolve({
          data: mockTableData[table] ?? [],
          error: mockTableError[table] ?? null,
        });
      };
      return chain;
    }),
  },
}));

const tablesQueried = () => mockCalls.map((c) => c.table).sort();
const opsFor = (table: string) => mockCalls.filter((c) => c.table === table).flatMap((c) => c.ops);

beforeEach(() => {
  mockCalls = [];
  mockTableData = {};
  mockTableError = {};
});

describe('NowRail scoped to her communities', () => {
  it('asks all three tables, each narrowed to the communities she joined', async () => {
    render(<NowRail open communityIds={['c1', 'c2']} onCount={jest.fn()} />);

    await waitFor(() => {
      expect(tablesQueried()).toEqual(['community_games', 'community_rooms', 'events']);
    });

    for (const table of ['community_rooms', 'community_games', 'events']) {
      const scoping = opsFor(table).filter(([op]) => op === 'in');
      expect(scoping).toContainEqual(['in', ['community_id', ['c1', 'c2']]]);
    }
  });

  it('windows events to the next 24 hours rather than showing every future plan', async () => {
    render(<NowRail open communityIds={['c1']} onCount={jest.fn()} />);

    await waitFor(() => expect(opsFor('events').length).toBeGreaterThan(0));

    const from = opsFor('events').find(([op]) => op === 'gte');
    const to = opsFor('events').find(([op]) => op === 'lte');
    expect(from).toBeDefined();
    expect(to).toBeDefined();

    const fromAt = Date.parse((from![1] as [string, string])[1]);
    const toAt = Date.parse((to![1] as [string, string])[1]);
    expect(toAt - fromAt).toBe(24 * 60 * 60 * 1000);
  });

  it('renders a live game and an event starting tonight, not only rooms', async () => {
    mockTableData.community_rooms = [];
    mockTableData.community_games = [{ communities: { name: 'WLW Hikers' }, games: { id: 'g1', name: 'Two Truths' } }];
    mockTableData.events = [{
      id: 'e1', title: 'Sunset walk', starts_at: new Date(Date.now() + 3_600_000).toISOString(),
      communities: { name: 'WLW Hikers' },
    }];

    const { getByTestId } = render(<NowRail open communityIds={['c1']} onCount={jest.fn()} />);

    await waitFor(() => {
      expect(getByTestId('now-rail-game-g1')).toBeTruthy();
      expect(getByTestId('now-rail-event-e1')).toBeTruthy();
    });
  });

  it('tells her the night is quiet in HER communities, not on Roxy', async () => {
    const { getByTestId } = render(<NowRail open communityIds={['c1']} onCount={jest.fn()} />);
    await waitFor(() => {
      expect(getByTestId('now-rail-empty')).toHaveTextContent(/in your communities tonight/i);
    });
  });

  it('survives one source failing instead of blanking the rail', async () => {
    // The card this replaces wrapped all three queries in a bare `catch` and
    // set an empty list, so a broken query and a quiet night were the same
    // screen. A rail that can still show two of three sources shows them.
    mockTableError.events = { message: 'boom' };
    mockTableData.community_rooms = [{ id: 'r1', name: 'Late night', participant_count: 4, communities: { name: 'WLW Hikers' } }];

    const { getByTestId, queryByTestId } = render(
      <NowRail open communityIds={['c1']} onCount={jest.fn()} />
    );

    await waitFor(() => expect(getByTestId('now-rail-room-r1')).toBeTruthy());
    expect(queryByTestId('now-rail-error')).toBeNull();
  });
});

describe('NowRail with no communities joined', () => {
  it('falls back to Roxy-wide live rooms instead of querying for nothing', async () => {
    render(<NowRail open communityIds={[]} onCount={jest.fn()} />);

    await waitFor(() => expect(tablesQueried()).toEqual(['community_rooms']));
    expect(opsFor('community_rooms').some(([op]) => op === 'in')).toBe(false);
  });

  it('points her at joining a community rather than at starting one', async () => {
    const { getByTestId } = render(<NowRail open communityIds={[]} onCount={jest.fn()} />);
    await waitFor(() => {
      expect(getByTestId('now-rail-empty')).toHaveTextContent(/join a community/i);
    });
  });
});
