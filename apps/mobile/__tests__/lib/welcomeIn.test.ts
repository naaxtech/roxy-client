/**
 * "You're in" + the first five minutes (G-11 ideal flow, step 9).
 *
 * Pins: who is greeted (a fresh approval, once per user per device), where
 * her checklist lives (AsyncStorage, keyed by user id), and which items she is
 * offered (only ones her access can actually open).
 */
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  WELCOME_WINDOW_DAYS,
  welcomeSeenKey,
  firstStepsKey,
  isFreshAdmission,
  shouldGreetNewMember,
  markWelcomeSeen,
  loadFirstSteps,
  markStepDone,
  dismissFirstSteps,
  buildFirstSteps,
  fetchAdmissionCommunity,
} from '../../lib/welcomeIn';

const { supabase } = jest.requireMock('../../lib/supabase') as { supabase: { from: jest.Mock } };
const { logError } = jest.requireMock('../../lib/errorLogger') as { logError: jest.Mock };

const NOW = new Date('2026-10-11T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

/** membership_applications .select().eq().maybeSingle() and communities likewise. */
function mockTables(rows: Record<string, { data: unknown; error: unknown }>) {
  supabase.from.mockImplementation((table: string) => ({
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve(rows[table] ?? { data: null, error: null }) }),
    }),
  }));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('storage keys are per user', () => {
  it('never shares a key between two accounts on one phone', () => {
    expect(welcomeSeenKey('u1')).not.toBe(welcomeSeenKey('u2'));
    expect(firstStepsKey('u1')).toContain('u1');
    expect(welcomeSeenKey('u1')).not.toBe(firstStepsKey('u1'));
  });
});

describe('isFreshAdmission', () => {
  it('an application approved today is fresh', () => {
    expect(isFreshAdmission({ status: 'approved', decided_at: daysAgo(0) }, NOW)).toBe(true);
  });
  it(`stops being fresh after ${WELCOME_WINDOW_DAYS} days`, () => {
    expect(isFreshAdmission({ status: 'approved', decided_at: daysAgo(WELCOME_WINDOW_DAYS + 1) }, NOW)).toBe(false);
  });
  it('a pending or rejected application is never greeted', () => {
    expect(isFreshAdmission({ status: 'pending', decided_at: null }, NOW)).toBe(false);
    expect(isFreshAdmission({ status: 'rejected', decided_at: daysAgo(0) }, NOW)).toBe(false);
  });
  it('no application (a grandfathered member) is never greeted', () => {
    expect(isFreshAdmission(null, NOW)).toBe(false);
  });
  it('an approval with no decided_at is not fresh (cannot tell when)', () => {
    expect(isFreshAdmission({ status: 'approved', decided_at: null }, NOW)).toBe(false);
  });
});

describe('shouldGreetNewMember', () => {
  it('greets a fresh approval she has not seen yet', async () => {
    mockTables({ membership_applications: { data: { status: 'approved', decided_at: daysAgo(1) }, error: null } });
    expect(await shouldGreetNewMember('u1', NOW)).toBe(true);
  });

  it('greets once: after markWelcomeSeen it never asks the server again', async () => {
    await markWelcomeSeen('u1');
    expect(await shouldGreetNewMember('u1', NOW)).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('one woman having seen it does not hide it from another on the same phone', async () => {
    await markWelcomeSeen('u1');
    mockTables({ membership_applications: { data: { status: 'approved', decided_at: daysAgo(1) }, error: null } });
    expect(await shouldGreetNewMember('u2', NOW)).toBe(true);
  });

  it('a read error fails quiet (no greeting) and is logged', async () => {
    mockTables({ membership_applications: { data: null, error: { message: 'boom' } } });
    expect(await shouldGreetNewMember('u1', NOW)).toBe(false);
    expect(logError).toHaveBeenCalled();
  });

  it('an old approval is not greeted', async () => {
    mockTables({ membership_applications: { data: { status: 'approved', decided_at: daysAgo(60) }, error: null } });
    expect(await shouldGreetNewMember('u1', NOW)).toBe(false);
  });
});

describe('first-steps checklist storage', () => {
  it('starts empty and not dismissed', async () => {
    expect(await loadFirstSteps('u1')).toEqual({ done: [], dismissed: false });
  });

  it('remembers a ticked step, once', async () => {
    await markStepDone('u1', 'dm_settings');
    await markStepDone('u1', 'dm_settings');
    expect(await loadFirstSteps('u1')).toEqual({ done: ['dm_settings'], dismissed: false });
    expect(await loadFirstSteps('u2')).toEqual({ done: [], dismissed: false });
  });

  it('can be dismissed, and stays dismissed', async () => {
    await dismissFirstSteps('u1');
    expect((await loadFirstSteps('u1')).dismissed).toBe(true);
  });

  it('a corrupted value is treated as a fresh checklist, never a crash', async () => {
    await AsyncStorage.setItem(firstStepsKey('u1'), '{not json');
    expect(await loadFirstSteps('u1')).toEqual({ done: [], dismissed: false });
  });

  it('ignores unknown step ids written by an older build', async () => {
    await AsyncStorage.setItem(firstStepsKey('u1'), JSON.stringify({ done: ['dm_settings', 'nope'], dismissed: false }));
    expect((await loadFirstSteps('u1')).done).toEqual(['dm_settings']);
  });
});

describe('buildFirstSteps', () => {
  const all = () => true;

  it('offers the four first-five-minutes steps, in order, each with a route', () => {
    const steps = buildFirstSteps({ community: { id: 'c1', name: 'Dykes of Leeds', slug: 'dol' }, can: all, canCommunity: all });
    expect(steps.map((s) => s.id)).toEqual(['say_hi', 'follow_three', 'dm_settings', 'introduce']);
    expect(steps[0].title).toContain('Dykes of Leeds');
    expect(steps[0].route).toBe('/community/c1');
    for (const s of steps) {
      expect(s.route).toMatch(/^\//);
      expect(s.a11yLabel.length).toBeGreaterThan(0);
    }
  });

  it('without a known community the say-hi step is left out, not pointed nowhere', () => {
    const steps = buildFirstSteps({ community: null, can: all, canCommunity: all });
    expect(steps.map((s) => s.id)).toEqual(['follow_three', 'dm_settings', 'introduce']);
  });

  it('never offers a step her access cannot open', () => {
    const steps = buildFirstSteps({
      community: { id: 'c1', name: 'X', slug: 'x' },
      can: (f) => f !== 'discover' && f !== 'officialChat',
      canCommunity: () => false,
    });
    expect(steps.map((s) => s.id)).toEqual(['dm_settings', 'introduce']);
  });

  it('public tier (limited launch): say hi in Roxy Official chat instead, no composer', () => {
    const steps = buildFirstSteps({
      community: { id: 'c1', name: 'Dykes of Leeds', slug: 'dol' },
      official: { id: 'off-1', name: 'Roxy Official', slug: 'roxy-official' },
      can: (f) => f === 'archive' || f === 'officialChat',
      canCommunity: (slug) => slug === 'roxy-official',
    });
    expect(steps.map((s) => s.id)).toEqual(['say_hi', 'dm_settings']);
    expect(steps[0].title).toBe('Say hi in Roxy Official');
    expect(steps[0].route).toBe('/community/channels/off-1');
  });
});

describe('fetchAdmissionCommunity', () => {
  it("reads the community from her own application (the code's community)", async () => {
    mockTables({
      membership_applications: { data: { community_id: 'c1' }, error: null },
      communities: { data: { id: 'c1', name: 'Dykes of Leeds', slug: 'dol' }, error: null },
    });
    expect(await fetchAdmissionCommunity('u1')).toEqual({ id: 'c1', name: 'Dykes of Leeds', slug: 'dol' });
  });

  it('no application -> null', async () => {
    mockTables({});
    expect(await fetchAdmissionCommunity('u1')).toBeNull();
  });

  it('an error -> null, logged', async () => {
    mockTables({ membership_applications: { data: null, error: { message: 'x' } } });
    expect(await fetchAdmissionCommunity('u1')).toBeNull();
    expect(logError).toHaveBeenCalled();
  });
});
