// jest.mock() must precede imports (hoisting requirement — see CLAUDE.md anti-pattern #2)
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getUser: jest.fn() },
  },
  callEdgeFunction: jest.fn(),
}));

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { useGateStore, JOIN_REASON_MIN, type Criterion, type ApplicationState } from '../../store/gateStore';

type MockedSupabase = { from: jest.Mock; rpc: jest.Mock; auth: { getUser: jest.Mock } };
const { supabase } = jest.requireMock('../../lib/supabase') as { supabase: MockedSupabase };
const { logError } = jest.requireMock('../../lib/errorLogger') as { logError: jest.Mock };

const COMMUNITY = 'community-1';

const APPLICATION: ApplicationState = {
  id: 'app-1',
  status: 'pending',
  submitted_at: '2026-08-01T09:00:00Z',
  decided_at: null,
  rejected_until: null,
  community_id: COMMUNITY,
};

const LEGAL_NAME: Criterion = {
  id: 'crit-legal-name',
  key: 'legal_name',
  kind: 'attribute',
  label: 'Real legal name',
  description: null,
  prompt: null,
  points: 3,
  is_required: false,
  sort_order: 10,
  community_id: null,
};

const OTHER: Criterion = {
  id: 'crit-join-reason',
  key: 'join_reason',
  kind: 'question',
  label: 'Why Roxy?',
  description: null,
  prompt: 'Tell us why you want to join.',
  points: 2,
  is_required: false,
  sort_order: 50,
  community_id: null,
};

/** Point `supabase.from(...).insert(...)` at a given result. */
const mockInsert = (result: { error: { code?: string; message: string } | null }) => {
  const insert = jest.fn().mockResolvedValue(result);
  supabase.from.mockReturnValue({ insert });
  return insert;
};

/**
 * Point a whole `loadApplication` pass at fixed rows. `from` has to dispatch on
 * the table because that call reads three of them, and the criteria query is
 * terminated by `.order()` rather than `.maybeSingle()`.
 */
const mockLoad = (criteria: Criterion[], application: ApplicationState | null = APPLICATION) => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  supabase.from.mockImplementation((table: string) => {
    if (table === 'membership_applications') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: application, error: null }) }),
        }),
      };
    }
    if (table === 'verification_criteria') {
      return {
        select: () => ({
          eq: () => ({ order: () => Promise.resolve({ data: criteria, error: null }) }),
        }),
      };
    }
    return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  useGateStore.setState({
    application: APPLICATION,
    criteria: [LEGAL_NAME, OTHER],
    metCriterionIds: new Set<string>(),
    score: 0,
    validatedCode: null,
  });
});

/**
 * vc_read (071:59) lets an applicant SELECT every active criterion on the
 * platform, but can_self_attest_criterion (081:153) accepts a write only for a
 * criterion that is global or her own community's. An out-of-scope question is
 * therefore a field whose save is refused by RLS every time, and points on the
 * score card she cannot earn.
 */
describe('gateStore.loadApplication — criteria are scoped to her own community', () => {
  // Fails before the fix: every active criterion on the platform was listed.
  it("drops another community's question", async () => {
    const foreign: Criterion = {
      ...OTHER,
      id: 'crit-foreign',
      key: 'foreign_question',
      community_id: 'community-2',
    };
    mockLoad([LEGAL_NAME, OTHER, foreign]);

    await useGateStore.getState().loadApplication();

    expect(useGateStore.getState().criteria.map((c) => c.id)).toEqual([
      LEGAL_NAME.id,
      OTHER.id,
    ]);
  });

  it("keeps her own community's question alongside the global ones", async () => {
    const own: Criterion = { ...OTHER, id: 'crit-own', community_id: COMMUNITY };
    mockLoad([LEGAL_NAME, own]);

    await useGateStore.getState().loadApplication();

    expect(useGateStore.getState().criteria.map((c) => c.id)).toEqual([LEGAL_NAME.id, 'crit-own']);
  });
});

/** Missing-function error, as PostgREST reports an RPC not deployed yet. */
const MISSING = { code: 'PGRST202', message: 'Could not find the function' };

/**
 * 130 / G-19: the legal name is stored AND its criterion marked by one
 * SECURITY DEFINER call, and a second call while she is pending corrects the
 * name instead of hitting a primary key. The client never writes
 * applicant_identity or application_criteria_met directly any more.
 */
describe('gateStore.saveLegalName — one RPC, correctable', () => {
  it('calls save_applicant_legal_name with the trimmed name and ticks the criterion', async () => {
    supabase.rpc.mockResolvedValue({ error: null });

    const outcome = await useGateStore.getState().saveLegalName('  Ada Lovelace  ');

    expect(outcome).toBe('saved');
    expect(supabase.rpc).toHaveBeenCalledWith('save_applicant_legal_name', { p_name: 'Ada Lovelace' });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(useGateStore.getState().metCriterionIds.has('crit-legal-name')).toBe(true);
    expect(useGateStore.getState().score).toBe(3);
  });

  it('lets her correct the name: a second save is a second successful call, not a conflict', async () => {
    supabase.rpc.mockResolvedValue({ error: null });

    expect(await useGateStore.getState().saveLegalName('Ada Lovelace')).toBe('saved');
    expect(await useGateStore.getState().saveLegalName('Ada King')).toBe('saved');
    expect(supabase.rpc).toHaveBeenLastCalledWith('save_applicant_legal_name', { p_name: 'Ada King' });
  });

  it('returns failed and logs when the server refuses, with nothing ticked', async () => {
    supabase.rpc.mockResolvedValue({ error: { code: '42501', message: 'no open application' } });

    const outcome = await useGateStore.getState().saveLegalName('Ada Lovelace');

    expect(outcome).toBe('failed');
    expect(logError).toHaveBeenCalled();
    expect(useGateStore.getState().metCriterionIds.size).toBe(0);
  });

  it('returns failed without a call when there is no application', async () => {
    useGateStore.setState({ application: null });
    expect(await useGateStore.getState().saveLegalName('Ada Lovelace')).toBe('failed');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns saved when the deployment has no legal_name criterion configured', async () => {
    useGateStore.setState({ criteria: [OTHER] });
    supabase.rpc.mockResolvedValue({ error: null });
    expect(await useGateStore.getState().saveLegalName('Ada Lovelace')).toBe('saved');
  });
});

/**
 * Rollout window only: a database without save_applicant_legal_name. The old
 * path's hard-won rules still hold — the name is never written then disowned,
 * and application_criteria_met is never written from the client.
 */
describe('gateStore.saveLegalName — pre-130 fallback', () => {
  it('never writes to application_criteria_met from the client', async () => {
    supabase.rpc.mockResolvedValueOnce({ error: MISSING }).mockResolvedValue({ error: null });
    mockInsert({ error: null });

    await useGateStore.getState().saveLegalName('Ada Lovelace');

    const tablesWritten = supabase.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(tablesWritten).not.toContain('application_criteria_met');
    expect(tablesWritten).toContain('applicant_identity');
  });

  it('reports saved_unscored — not failure — when the criterion cannot be marked', async () => {
    supabase.rpc.mockResolvedValue({ error: MISSING });
    mockInsert({ error: null });

    expect(await useGateStore.getState().saveLegalName('Ada Lovelace')).toBe('saved_unscored');
    expect(useGateStore.getState().score).toBe(0);
    expect(logError).not.toHaveBeenCalled();
  });

  it('returns already_saved on a primary key conflict, quietly', async () => {
    supabase.rpc.mockResolvedValue({ error: MISSING });
    mockInsert({ error: { code: '23505', message: 'duplicate key value' } });

    expect(await useGateStore.getState().saveLegalName('Ada Lovelace')).toBe('already_saved');
    expect(logError).not.toHaveBeenCalled();
  });

  it('returns saved and ticks when mark_criterion_met exists', async () => {
    supabase.rpc.mockResolvedValueOnce({ error: MISSING }).mockResolvedValue({ error: null });
    mockInsert({ error: null });

    expect(await useGateStore.getState().saveLegalName('Ada Lovelace')).toBe('saved');
    expect(useGateStore.getState().metCriterionIds.has('crit-legal-name')).toBe(true);
  });
});

/**
 * G-15: a held code that cannot open her application leaves her signed in on
 * a recoverable screen with a sentence she can act on — never with access,
 * never with a silent null.
 */
describe('gateStore.submitApplicationForCode — redeem_invite_code', () => {
  beforeEach(() => useGateStore.setState({ validatedCode: 'ABCDEFGHJK', redeemError: null }));

  it('redeems through redeem_invite_code and forgets the code on success', async () => {
    supabase.rpc.mockResolvedValue({ data: { ok: true, application_id: 'app-9' }, error: null });

    const id = await useGateStore.getState().submitApplicationForCode();

    expect(supabase.rpc).toHaveBeenCalledWith('redeem_invite_code', { p_code: 'ABCDEFGHJK' });
    expect(id).toBe('app-9');
    expect(useGateStore.getState().validatedCode).toBeNull();
    expect(useGateStore.getState().redeemError).toBeNull();
  });

  it.each(['exhausted', 'expired', 'revoked', 'cooldown', 'already_member'])(
    'a %s verdict is reported and the spent code dropped',
    async (reason) => {
      supabase.rpc.mockResolvedValue({ data: { ok: false, reason }, error: null });

      expect(await useGateStore.getState().submitApplicationForCode()).toBeNull();
      expect(useGateStore.getState().redeemError).toBe(reason);
      expect(useGateStore.getState().validatedCode).toBeNull();
    },
  );

  it('keeps the code when we never reached the server, so she can retry', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });

    expect(await useGateStore.getState().submitApplicationForCode()).toBeNull();
    expect(useGateStore.getState().redeemError).toBe('unavailable');
    expect(useGateStore.getState().validatedCode).toBe('ABCDEFGHJK');
    expect(logError).toHaveBeenCalled();
  });

  it('keeps the code when rate limited, so she can retry later', async () => {
    supabase.rpc.mockResolvedValue({ data: { ok: false, reason: 'rate_limited' }, error: null });

    await useGateStore.getState().submitApplicationForCode();
    expect(useGateStore.getState().validatedCode).toBe('ABCDEFGHJK');
  });

  it('maps an unknown server reason to invalid rather than inventing one', async () => {
    supabase.rpc.mockResolvedValue({ data: { ok: false, reason: 'something_new' }, error: null });

    await useGateStore.getState().submitApplicationForCode();
    expect(useGateStore.getState().redeemError).toBe('invalid');
  });
});

/** G-14: the application enters the queue only when she sends it. */
describe('gateStore.submitForReview — submit_application', () => {
  it('calls submit_application and records ready_at', async () => {
    supabase.rpc.mockResolvedValue({ data: { ok: true, ready_at: '2026-10-10T10:00:00Z' }, error: null });

    const outcome = await useGateStore.getState().submitForReview();

    expect(supabase.rpc).toHaveBeenCalledWith('submit_application');
    expect(outcome).toEqual({ ok: true });
    expect(useGateStore.getState().application?.ready_at).toBe('2026-10-10T10:00:00Z');
  });

  it('passes the server reason through when the join reason is too short', async () => {
    supabase.rpc.mockResolvedValue({ data: { ok: false, reason: 'join_reason_too_short' }, error: null });

    expect(await useGateStore.getState().submitForReview()).toEqual({
      ok: false, reason: 'join_reason_too_short', missing: undefined,
    });
    expect(useGateStore.getState().application?.ready_at ?? null).toBeNull();
  });

  it('reports unavailable and logs on a transport failure', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });

    expect(await useGateStore.getState().submitForReview()).toEqual({ ok: false, reason: 'unavailable' });
    expect(logError).toHaveBeenCalled();
  });

  it('passes the missing criteria keys through', async () => {
    supabase.rpc.mockResolvedValue({
      data: { ok: false, reason: 'missing_required', missing: ['legal_name'] },
      error: null,
    });
    expect(await useGateStore.getState().submitForReview()).toEqual({
      ok: false, reason: 'missing_required', missing: ['legal_name'],
    });
  });

  it('a thrown request never leaves the button stuck busy', async () => {
    supabase.rpc.mockRejectedValue(new Error('socket hang up'));

    expect(await useGateStore.getState().submitForReview()).toEqual({ ok: false, reason: 'unavailable' });
    expect(useGateStore.getState().submitting).toBe(false);
    expect(logError).toHaveBeenCalled();
  });
});

/** G-24: the join reason earns its point at 40 characters, not for "asdf". */
describe('gateStore.saveAnswer — join reason threshold', () => {
  const upsertOk = () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    supabase.from.mockReturnValue({ upsert });
    return upsert;
  };

  it('saves a short join reason but does not tick it', async () => {
    upsertOk();
    expect(await useGateStore.getState().saveAnswer(OTHER.id, 'asdf')).toBe(true);
    expect(useGateStore.getState().metCriterionIds.has(OTHER.id)).toBe(false);
  });

  it('ticks a join reason of 40+ characters', async () => {
    upsertOk();
    await useGateStore.getState().saveAnswer(OTHER.id, 'x'.repeat(JOIN_REASON_MIN));
    expect(useGateStore.getState().metCriterionIds.has(OTHER.id)).toBe(true);
  });
});
