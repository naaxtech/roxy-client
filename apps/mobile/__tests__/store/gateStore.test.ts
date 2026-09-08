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

import { useGateStore, type Criterion, type ApplicationState } from '../../store/gateStore';

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

describe('gateStore.saveLegalName — the name is never written then disowned', () => {
  /**
   * The regression this whole change exists for. application_criteria_met has
   * only SELECT policies (migration 071), so the old direct upsert was refused
   * every time — and it was attempted AFTER the name had already been inserted,
   * so the applicant was told "could not save" about data that was on file for
   * good. Any write to that table from the client is the bug coming back.
   */
  it('never writes to application_criteria_met from the client', async () => {
    mockInsert({ error: null });
    supabase.rpc.mockResolvedValue({ error: null });

    await useGateStore.getState().saveLegalName('Ada Lovelace');

    const tablesWritten = supabase.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(tablesWritten).not.toContain('application_criteria_met');
    expect(tablesWritten).toContain('applicant_identity');
  });

  // Fails before the fix: the old implementation returned boolean false here,
  // after the name had already been stored.
  it('reports saved_unscored — not failure — when the criterion cannot be marked', async () => {
    mockInsert({ error: null });
    supabase.rpc.mockResolvedValue({
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });

    const outcome = await useGateStore.getState().saveLegalName('Ada Lovelace');

    expect(outcome).toBe('saved_unscored');
  });

  it('trims the name before storing it', async () => {
    const insert = mockInsert({ error: null });
    supabase.rpc.mockResolvedValue({ error: null });

    await useGateStore.getState().saveLegalName('  Ada Lovelace  ');

    expect(insert).toHaveBeenCalledWith({
      application_id: 'app-1',
      legal_name: 'Ada Lovelace',
    });
  });
});

describe('gateStore.saveLegalName — outcomes', () => {
  it('returns saved and marks the criterion when the RPC succeeds', async () => {
    mockInsert({ error: null });
    supabase.rpc.mockResolvedValue({ error: null });

    const outcome = await useGateStore.getState().saveLegalName('Ada Lovelace');

    expect(outcome).toBe('saved');
    expect(supabase.rpc).toHaveBeenCalledWith('mark_criterion_met', {
      p_application_id: 'app-1',
      p_criterion_id: 'crit-legal-name',
    });
    expect(useGateStore.getState().metCriterionIds.has('crit-legal-name')).toBe(true);
    expect(useGateStore.getState().score).toBe(3);
  });

  it('does not inflate the score when the criterion was not marked', async () => {
    mockInsert({ error: null });
    supabase.rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'missing' } });

    await useGateStore.getState().saveLegalName('Ada Lovelace');

    expect(useGateStore.getState().metCriterionIds.has('crit-legal-name')).toBe(false);
    expect(useGateStore.getState().score).toBe(0);
  });

  it('returns already_saved on a primary key conflict', async () => {
    mockInsert({ error: { code: '23505', message: 'duplicate key value' } });

    const outcome = await useGateStore.getState().saveLegalName('Ada Lovelace');

    expect(outcome).toBe('already_saved');
    // A name she already gave us is not an error worth paging anyone about.
    expect(logError).not.toHaveBeenCalled();
  });

  it('returns failed and logs when nothing could be written', async () => {
    mockInsert({ error: { code: '42501', message: 'new row violates row-level security' } });

    const outcome = await useGateStore.getState().saveLegalName('Ada Lovelace');

    expect(outcome).toBe('failed');
    expect(logError).toHaveBeenCalled();
    // Nothing was stored, so the criterion RPC must not have been attempted.
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns failed when there is no application to attach the name to', async () => {
    useGateStore.setState({ application: null });

    const outcome = await useGateStore.getState().saveLegalName('Ada Lovelace');

    expect(outcome).toBe('failed');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns saved when the deployment has no legal_name criterion configured', async () => {
    useGateStore.setState({ criteria: [OTHER] });
    mockInsert({ error: null });

    const outcome = await useGateStore.getState().saveLegalName('Ada Lovelace');

    expect(outcome).toBe('saved');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('gateStore.saveLegalName — a missing RPC is expected, other failures are not', () => {
  it('stays quiet when mark_criterion_met is simply not deployed yet', async () => {
    mockInsert({ error: null });
    supabase.rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'not in schema cache' } });

    await useGateStore.getState().saveLegalName('Ada Lovelace');

    expect(logError).not.toHaveBeenCalled();
  });

  it('treats the Postgres undefined-function code the same way', async () => {
    mockInsert({ error: null });
    supabase.rpc.mockResolvedValue({ error: { code: '42883', message: 'function does not exist' } });

    const outcome = await useGateStore.getState().saveLegalName('Ada Lovelace');

    expect(outcome).toBe('saved_unscored');
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs a real RPC failure while still reporting the name as saved', async () => {
    mockInsert({ error: null });
    supabase.rpc.mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });

    const outcome = await useGateStore.getState().saveLegalName('Ada Lovelace');

    expect(outcome).toBe('saved_unscored');
    expect(logError).toHaveBeenCalled();
  });
});
