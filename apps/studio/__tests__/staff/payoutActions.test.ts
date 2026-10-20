jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/staff-guard', () => {
  const actual = jest.requireActual('@/lib/staff-guard');
  return { ...actual, assertStaffAction: jest.fn() };
});
jest.mock('@/lib/staff-auth', () => ({ callEdgeAsService: jest.fn() }));

const { createClient } = jest.requireMock('@/lib/supabase/server');
const { assertStaffAction } = jest.requireMock('@/lib/staff-guard');
const { callEdgeAsService } = jest.requireMock('@/lib/staff-auth');

const EVENT = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';

function mockRpc(result: { data?: unknown; error?: unknown }) {
  const rpc = jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  createClient.mockResolvedValue({ rpc });
  return rpc;
}

beforeEach(() => {
  jest.clearAllMocks();
  assertStaffAction.mockResolvedValue({ userId: 'core-1', isCore: true });
});

describe('setPayoutBlock', () => {
  it('is core only, refused before the database', async () => {
    assertStaffAction.mockResolvedValue({ userId: 'staff-1', isCore: false });
    const rpc = mockRpc({});
    const { setPayoutBlock } = await import('@/app/(dashboard)/staff/payout-actions');
    await expect(setPayoutBlock(EVENT, true, 'chargeback')).resolves.toEqual({
      ok: false,
      error: 'Only core staff can change a payout.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a bad id and a missing reason', async () => {
    const rpc = mockRpc({});
    const { setPayoutBlock } = await import('@/app/(dashboard)/staff/payout-actions');
    await expect(setPayoutBlock('x', true, 'chargeback')).resolves.toEqual({ ok: false, error: 'That event id is not valid.' });
    await expect(setPayoutBlock(EVENT, true, '')).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls staff_set_payout_block and reports what changed', async () => {
    const rpc = mockRpc({ data: { changed: false, payout_blocked: true } });
    const { setPayoutBlock } = await import('@/app/(dashboard)/staff/payout-actions');
    await expect(setPayoutBlock(EVENT, true, ' chargeback ')).resolves.toEqual({
      ok: true,
      message: 'This payout was already blocked. Nothing changed.',
    });
    expect(rpc).toHaveBeenCalledWith('staff_set_payout_block', {
      p_event_id: EVENT,
      p_blocked: true,
      p_reason: 'chargeback',
    });
  });

  it('surfaces the RPC refusal', async () => {
    mockRpc({ error: { code: '55000', message: 'This payout was already released' } });
    const { setPayoutBlock } = await import('@/app/(dashboard)/staff/payout-actions');
    await expect(setPayoutBlock(EVENT, true, 'chargeback')).resolves.toEqual({
      ok: false,
      error: 'This payout was already released',
    });
  });
});

describe('releasePayout', () => {
  it('is core only, refused before the edge call', async () => {
    assertStaffAction.mockResolvedValue({ userId: 'staff-1', isCore: false });
    const { releasePayout } = await import('@/app/(dashboard)/staff/payout-actions');
    await expect(releasePayout(EVENT)).resolves.toEqual({ ok: false, error: 'Only core staff can release a payout.' });
    expect(callEdgeAsService).not.toHaveBeenCalled();
  });

  it('reports a skipped release as a failure, not success', async () => {
    callEdgeAsService.mockResolvedValue({ ok: true, data: { released: 0, skipped: 1, failed: 0 } });
    const { releasePayout } = await import('@/app/(dashboard)/staff/payout-actions');
    await expect(releasePayout(EVENT)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/^Not released/) });
    expect(callEdgeAsService).toHaveBeenCalledWith('release-payout', { event_id: EVENT });
  });

  it('reports a real transfer', async () => {
    callEdgeAsService.mockResolvedValue({ ok: true, data: { released: 1, skipped: 0, failed: 0 } });
    const { releasePayout } = await import('@/app/(dashboard)/staff/payout-actions');
    await expect(releasePayout(EVENT)).resolves.toEqual({ ok: true, message: 'Payout released to the host.' });
  });

  it('reports an edge failure', async () => {
    callEdgeAsService.mockResolvedValue({ ok: false, status: 500, error: 'boom' });
    const { releasePayout } = await import('@/app/(dashboard)/staff/payout-actions');
    await expect(releasePayout(EVENT)).resolves.toEqual({
      ok: false,
      error: 'The payout service did not answer (500). Nothing was paid — try again.',
    });
  });
});
