jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/staff-guard', () => {
  const actual = jest.requireActual('@/lib/staff-guard');
  return { ...actual, assertStaffAction: jest.fn() };
});

const { createClient } = jest.requireMock('@/lib/supabase/server');
const { assertStaffAction } = jest.requireMock('@/lib/staff-guard');

const REPORT_ID = '8b0f3c5e-1d2a-4c3b-9e8f-1a2b3c4d5e6f';

function mockRpc(result: { data?: unknown; error?: unknown }) {
  const rpc = jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  createClient.mockResolvedValue({ rpc });
  return rpc;
}

beforeEach(() => {
  jest.clearAllMocks();
  assertStaffAction.mockResolvedValue({ userId: 'staff-1', isCore: false });
});

describe('resolveReport', () => {
  it('refuses a non-staff caller before touching the database', async () => {
    assertStaffAction.mockRejectedValue(new Error('Staff only.'));
    const rpc = mockRpc({});
    const { resolveReport } = await import('@/app/(dashboard)/staff/reports/actions');
    await expect(resolveReport(REPORT_ID, 'dismiss', '')).rejects.toThrow('Staff only.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a uuid', async () => {
    const rpc = mockRpc({});
    const { resolveReport } = await import('@/app/(dashboard)/staff/reports/actions');
    await expect(resolveReport("1' or 1=1", 'dismiss', '')).resolves.toEqual({
      ok: false,
      error: 'That report id is not valid.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an unknown choice and an over-long note', async () => {
    const rpc = mockRpc({});
    const { resolveReport } = await import('@/app/(dashboard)/staff/reports/actions');
    await expect(resolveReport(REPORT_ID, 'nuke' as never, '')).resolves.toMatchObject({ ok: false });
    await expect(resolveReport(REPORT_ID, 'dismiss', 'x'.repeat(2001))).resolves.toMatchObject({
      ok: false,
      error: 'Keep the note under 2000 characters.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls staff_resolve_report with the mapped arguments and reports the real result', async () => {
    const rpc = mockRpc({ data: { status: 'actioned', resolved: 2, hidden: true, suspension_id: 's1' } });
    const { resolveReport } = await import('@/app/(dashboard)/staff/reports/actions');
    const result = await resolveReport(REPORT_ID, 'hide_suspend', '  repeated slurs  ');
    expect(rpc).toHaveBeenCalledWith('staff_resolve_report', {
      p_report_id: REPORT_ID,
      p_action: 'hide',
      p_note: 'repeated slurs',
      p_suspend_author: true,
    });
    expect(result).toEqual({
      ok: true,
      message: 'Actioned 2 reports. The content is hidden. The member is suspended.',
    });
  });

  it('sends a null note when none is given', async () => {
    const rpc = mockRpc({ data: { status: 'dismissed', resolved: 1, hidden: false, suspension_id: null } });
    const { resolveReport } = await import('@/app/(dashboard)/staff/reports/actions');
    await resolveReport(REPORT_ID, 'dismiss', '   ');
    expect(rpc.mock.calls[0][1].p_note).toBeNull();
  });

  it('returns the RPC refusal instead of pretending it worked', async () => {
    mockRpc({ error: { code: '55000', message: 'This report was already resolved' } });
    const { resolveReport } = await import('@/app/(dashboard)/staff/reports/actions');
    await expect(resolveReport(REPORT_ID, 'dismiss', '')).resolves.toEqual({
      ok: false,
      error: 'This report was already resolved by someone else. Reload to see the outcome.',
    });
  });
});
