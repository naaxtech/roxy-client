// Inline mock factories only — see CLAUDE.md §12.2 (jest.mock hoisting).
jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

jest.mock('../../lib/errorLogger', () => ({
  logError: jest.fn(),
}));

import { syncMyBadges, BADGE_SYNC_MIN_INTERVAL_MS } from '../../lib/badges';

const { supabase } = jest.requireMock('../../lib/supabase');
const { logError } = jest.requireMock('../../lib/errorLogger');

// The throttle is keyed by member id and lives for the life of the module, so
// every test uses its own id rather than reaching into module state to reset it.
let idCounter = 0;
function freshMemberId(): string {
  idCounter += 1;
  return `member-${idCounter}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  supabase.rpc.mockResolvedValue({ data: 0, error: null });
});

describe('syncMyBadges', () => {
  it('calls the sync_my_badges RPC with no arguments', async () => {
    await syncMyBadges(freshMemberId());

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('sync_my_badges');
  });

  it('reports how many badges were newly earned', async () => {
    supabase.rpc.mockResolvedValue({ data: 3, error: null });

    await expect(syncMyBadges(freshMemberId())).resolves.toEqual({
      status: 'synced',
      newlyEarned: 3,
    });
  });

  it('reports zero newly earned when the RPC returns no payload', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    await expect(syncMyBadges(freshMemberId())).resolves.toEqual({
      status: 'synced',
      newlyEarned: 0,
    });
  });

  it('skips a second sync for the same member inside the throttle window', async () => {
    const memberId = freshMemberId();

    await syncMyBadges(memberId);
    const second = await syncMyBadges(memberId);

    expect(second).toEqual({ status: 'skipped' });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('syncs again once the throttle window has elapsed', async () => {
    const memberId = freshMemberId();
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000_000);
    await syncMyBadges(memberId);

    nowSpy.mockReturnValue(1_000_000 + BADGE_SYNC_MIN_INTERVAL_MS + 1);
    const second = await syncMyBadges(memberId);

    nowSpy.mockRestore();

    expect(second).toEqual({ status: 'synced', newlyEarned: 0 });
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });

  it('runs regardless of the throttle when forced', async () => {
    const memberId = freshMemberId();

    await syncMyBadges(memberId);
    const second = await syncMyBadges(memberId, { force: true });

    expect(second).toEqual({ status: 'synced', newlyEarned: 0 });
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });

  it('never lets a recent sync by one member throttle another member', async () => {
    await syncMyBadges(freshMemberId());
    const other = await syncMyBadges(freshMemberId());

    expect(other).toEqual({ status: 'synced', newlyEarned: 0 });
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });

  it('logs and reports failure when the RPC returns an error', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    await expect(syncMyBadges(freshMemberId())).resolves.toEqual({ status: 'failed' });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(expect.any(Error), 'badges.sync');
  });

  it('logs and reports failure when the RPC rejects, and never throws', async () => {
    supabase.rpc.mockRejectedValue(new Error('network down'));

    await expect(syncMyBadges(freshMemberId())).resolves.toEqual({ status: 'failed' });
    expect(logError).toHaveBeenCalledWith(expect.any(Error), 'badges.sync');
  });

  it('does not retry a failing sync on the very next call', async () => {
    const memberId = freshMemberId();
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await syncMyBadges(memberId);
    const second = await syncMyBadges(memberId);

    expect(second).toEqual({ status: 'skipped' });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('reports failure without calling the RPC when there is no signed-in member', async () => {
    await expect(syncMyBadges(undefined)).resolves.toEqual({ status: 'skipped' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
