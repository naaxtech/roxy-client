jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/staff-guard', () => {
  const actual = jest.requireActual('@/lib/staff-guard');
  return { ...actual, assertStaffAction: jest.fn() };
});

const { createClient } = jest.requireMock('@/lib/supabase/server');
const { assertStaffAction } = jest.requireMock('@/lib/staff-guard');

const MEMBER = '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

function mockRpc(...results: { data?: unknown; error?: unknown }[]) {
  const rpc = jest.fn();
  for (const r of results) rpc.mockResolvedValueOnce({ data: r.data ?? null, error: r.error ?? null });
  createClient.mockResolvedValue({ rpc });
  return rpc;
}

beforeEach(() => {
  jest.clearAllMocks();
  assertStaffAction.mockResolvedValue({ userId: 'staff-1', isCore: false });
});

describe('suspendMember', () => {
  it('refuses a non-staff caller before the database', async () => {
    assertStaffAction.mockRejectedValue(new Error('Staff only.'));
    const rpc = mockRpc();
    const { suspendMember } = await import('@/app/(dashboard)/staff/members/actions');
    await expect(suspendMember(MEMBER, 'harassment', '')).rejects.toThrow('Staff only.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a bad id and a short reason without calling the RPC', async () => {
    const rpc = mockRpc();
    const { suspendMember } = await import('@/app/(dashboard)/staff/members/actions');
    await expect(suspendMember('nope', 'harassment', '')).resolves.toEqual({ ok: false, error: 'That member id is not valid.' });
    await expect(suspendMember(MEMBER, 'x', '')).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls suspend_member with the trimmed reason', async () => {
    const rpc = mockRpc({ data: 'susp-1' });
    const { suspendMember } = await import('@/app/(dashboard)/staff/members/actions');
    await expect(suspendMember(MEMBER, '  harassment after warnings ', '')).resolves.toEqual({
      ok: true,
      message: 'Suspended. She is signed out everywhere and cannot sign back in.',
    });
    expect(rpc).toHaveBeenCalledWith('suspend_member', { p_user_id: MEMBER, p_reason: 'harassment after warnings' });
  });

  it('sends an end date as p_until, and says so honestly when the database cannot time a suspension', async () => {
    const rpc = mockRpc({ error: { code: 'PGRST202', message: 'Could not find the function' } });
    const { suspendMember } = await import('@/app/(dashboard)/staff/members/actions');
    const result = await suspendMember(MEMBER, 'cooling off', '2099-01-31');
    expect(rpc).toHaveBeenCalledWith('suspend_member', {
      p_user_id: MEMBER,
      p_reason: 'cooling off',
      p_until: '2099-01-31T23:59:59.000Z',
    });
    expect(result).toEqual({
      ok: false,
      error:
        'This database cannot end a suspension on a date yet. Nothing was changed. Suspend without an end date and set a reminder to lift it.',
    });
  });

  it('surfaces the RPC refusal', async () => {
    mockRpc({ error: { code: '23505', message: 'This member is already suspended' } });
    const { suspendMember } = await import('@/app/(dashboard)/staff/members/actions');
    await expect(suspendMember(MEMBER, 'harassment', '')).resolves.toEqual({
      ok: false,
      error: 'This member is already suspended',
    });
  });
});

describe('unsuspendMember', () => {
  it('is core only, checked before the database', async () => {
    const rpc = mockRpc();
    const { unsuspendMember } = await import('@/app/(dashboard)/staff/members/actions');
    await expect(unsuspendMember(MEMBER, '')).resolves.toEqual({
      ok: false,
      error: 'Only core staff can lift a suspension.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls unsuspend_member for core with a null note when blank', async () => {
    assertStaffAction.mockResolvedValue({ userId: 'core-1', isCore: true });
    const rpc = mockRpc({ data: 'susp-1' });
    const { unsuspendMember } = await import('@/app/(dashboard)/staff/members/actions');
    await expect(unsuspendMember(MEMBER, '  ')).resolves.toEqual({
      ok: true,
      message: 'Suspension lifted. She can sign in again.',
    });
    expect(rpc).toHaveBeenCalledWith('unsuspend_member', { p_user_id: MEMBER, p_note: null });
  });
});
