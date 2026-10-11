jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/staff-guard', () => {
  const actual = jest.requireActual('@/lib/staff-guard');
  return { ...actual, assertStaffAction: jest.fn() };
});

const { createClient } = jest.requireMock('@/lib/supabase/server');
const { assertStaffAction } = jest.requireMock('@/lib/staff-guard');

const OFFICIAL = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OTHER = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

interface Recorded {
  inserted: Record<string, unknown>[] | null;
  communityLookups: { col: string; val: string }[];
}

function mockDb(opts: {
  community?: { id: string; name: string } | null;
  insertError?: { code: string; message: string } | null;
  insertErrorOnce?: { code: string; message: string };
}) {
  const rec: Recorded = { inserted: null, communityLookups: [] };
  let failedOnce = false;
  const from = jest.fn((table: string) => {
    if (table === 'communities') {
      return {
        select: () => ({
          eq: (col: string, val: string) => {
            rec.communityLookups.push({ col, val });
            return { maybeSingle: async () => ({ data: opts.community ?? null, error: null }) };
          },
        }),
      };
    }
    if (table === 'invite_codes') {
      return {
        insert: (rows: Record<string, unknown>[]) => {
          rec.inserted = rows;
          return {
            select: async () => {
              if (opts.insertErrorOnce && !failedOnce) {
                failedOnce = true;
                return { data: null, error: opts.insertErrorOnce };
              }
              if (opts.insertError) return { data: null, error: opts.insertError };
              return {
                data: rows.map((r, i) => ({ code: `CODE${String(i).padStart(4, '0')}`, expires_at: r.expires_at })),
                error: null,
              };
            },
          };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  createClient.mockResolvedValue({ from });
  return { rec, from };
}

const EXPIRY = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const EXPIRES_ISO = `${EXPIRY}T23:59:59.000Z`;
const FORM = { count: '3', label: 'Wave 1', expiry: EXPIRY, communityId: '' };

beforeEach(() => {
  jest.clearAllMocks();
  assertStaffAction.mockResolvedValue({ userId: 'staff-1', isCore: false });
});

describe('createInviteWave', () => {
  it('refuses a non-staff caller before the database', async () => {
    assertStaffAction.mockRejectedValue(new Error('Staff only.'));
    const { from } = mockDb({});
    const { createInviteWave } = await import('@/app/(dashboard)/staff/launch/waves/actions');
    await expect(createInviteWave(FORM)).rejects.toThrow('Staff only.');
    expect(from).not.toHaveBeenCalled();
  });

  it('validates before touching the database', async () => {
    const { from } = mockDb({});
    const { createInviteWave } = await import('@/app/(dashboard)/staff/launch/waves/actions');
    await expect(createInviteWave({ ...FORM, count: '500' })).resolves.toMatchObject({ ok: false });
    expect(from).not.toHaveBeenCalled();
  });

  it('defaults to Roxy Official and mints N single-use codes in ONE insert, code left to the DB default', async () => {
    const { rec } = mockDb({ community: { id: OFFICIAL, name: 'Roxy Official' } });
    const { createInviteWave } = await import('@/app/(dashboard)/staff/launch/waves/actions');
    const result = await createInviteWave(FORM);
    expect(rec.communityLookups).toEqual([{ col: 'slug', val: 'roxy-official' }]);
    expect(rec.inserted).toHaveLength(3);
    for (const row of rec.inserted ?? []) {
      expect(row).toEqual({
        community_id: OFFICIAL,
        created_by: 'staff-1',
        label: 'Wave 1',
        max_uses: 1,
        expires_at: EXPIRES_ISO,
      });
      expect(row).not.toHaveProperty('code');
    }
    expect(result).toEqual({
      ok: true,
      communityName: 'Roxy Official',
      label: 'Wave 1',
      codes: [
        { code: 'CODE0000', expiresAt: EXPIRES_ISO },
        { code: 'CODE0001', expiresAt: EXPIRES_ISO },
        { code: 'CODE0002', expiresAt: EXPIRES_ISO },
      ],
    });
  });

  it('uses the chosen community when given', async () => {
    const { rec } = mockDb({ community: { id: OTHER, name: 'Book Club' } });
    const { createInviteWave } = await import('@/app/(dashboard)/staff/launch/waves/actions');
    await createInviteWave({ ...FORM, communityId: OTHER });
    expect(rec.communityLookups).toEqual([{ col: 'id', val: OTHER }]);
    expect(rec.inserted?.[0].community_id).toBe(OTHER);
  });

  it('says so when the community does not exist', async () => {
    mockDb({ community: null });
    const { createInviteWave } = await import('@/app/(dashboard)/staff/launch/waves/actions');
    await expect(createInviteWave(FORM)).resolves.toEqual({
      ok: false,
      error: 'That community could not be found. Nothing was created.',
    });
  });

  it('retries once on a code collision, then reports the real result', async () => {
    const { from } = mockDb({
      community: { id: OFFICIAL, name: 'Roxy Official' },
      insertErrorOnce: { code: '23505', message: 'duplicate key' },
    });
    const { createInviteWave } = await import('@/app/(dashboard)/staff/launch/waves/actions');
    const result = await createInviteWave(FORM);
    expect(result).toMatchObject({ ok: true });
    expect(from.mock.calls.filter((c) => c[0] === 'invite_codes')).toHaveLength(2);
  });

  it('turns an RLS refusal into words and creates nothing', async () => {
    mockDb({
      community: { id: OFFICIAL, name: 'Roxy Official' },
      insertError: { code: '42501', message: 'new row violates row-level security policy' },
    });
    const { createInviteWave } = await import('@/app/(dashboard)/staff/launch/waves/actions');
    await expect(createInviteWave(FORM)).resolves.toEqual({
      ok: false,
      error: 'Roxy refused that batch: this database only lets core staff (or that community’s admins) mint codes. Nothing was created.',
    });
  });
});
