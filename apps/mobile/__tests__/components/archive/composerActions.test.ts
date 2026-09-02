jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getSession: jest.fn() },
  },
  callEdgeFunction: jest.fn(),
}));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { submitReview, submitContentNote, submitEntry, submitEdit } from '../../../components/archive/composerActions';

const { supabase, callEdgeFunction } = jest.requireMock('../../../lib/supabase');
const { logError } = jest.requireMock('../../../lib/errorLogger');

type Result = { data?: unknown; error?: unknown };

/**
 * Chainable PostgREST stub, same shape as archiveStore's own test helper —
 * awaitable at any point in the chain so `.select().maybeSingle()` and a bare
 * `await` both resolve to the same result.
 */
function makeChain(result: Result) {
  const chain: Record<string, unknown> = {};
  const passthrough = ['select', 'eq', 'upsert', 'insert'];
  passthrough.forEach((m) => {
    chain[m] = jest.fn(() => chain);
  });
  (chain as any).maybeSingle = jest.fn(() => Promise.resolve(result));
  return chain;
}

const signedIn = (userId = 'user-1') =>
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: userId } } } });

const signedOut = () => supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

beforeEach(() => {
  jest.clearAllMocks();
  signedIn();
});

describe('submitReview', () => {
  it('upserts the review keyed on entry+author, with the ack she just gave', async () => {
    const chain = makeChain({ data: { id: 'r1' }, error: null });
    supabase.from.mockReturnValue(chain);

    const result = await submitReview('e1', 'Loved the gloves scene.', true, true);

    expect(supabase.from).toHaveBeenCalledWith('archive_reviews');
    expect(chain.upsert).toHaveBeenCalledWith(
      {
        entry_id: 'e1',
        author_id: 'user-1',
        body: 'Loved the gloves scene.',
        is_recommend: true,
        no_spoilers_ack: true,
      },
      { onConflict: 'entry_id,author_id' }
    );
    expect(result).toEqual({ data: { id: 'r1' }, error: null });
  });

  it('refuses to write without a real session rather than sending a null author', async () => {
    signedOut();
    const result = await submitReview('e1', 'text', true, true);
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/sign in/i);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('never reports success on a 200 that wrote zero rows', async () => {
    const chain = makeChain({ data: null, error: null });
    supabase.from.mockReturnValue(chain);
    const result = await submitReview('e1', 'text', true, true);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('translates RLS refusal (42501) into an approved-membership message, not a raw code', async () => {
    const chain = makeChain({ data: null, error: { code: '42501', message: 'denied' } });
    supabase.from.mockReturnValue(chain);
    const result = await submitReview('e1', 'text', true, true);
    expect(result.error).toMatch(/approved/i);
    expect(logError).toHaveBeenCalled();
  });

  it('returns a generic error and logs, never throwing, on an unknown failure', async () => {
    const chain = makeChain({ data: null, error: { code: '500', message: 'boom' } });
    supabase.from.mockReturnValue(chain);
    await expect(submitReview('e1', 'text', true, true)).resolves.toEqual(
      expect.objectContaining({ data: null, error: expect.any(String) })
    );
    expect(logError).toHaveBeenCalled();
  });
});

describe('submitContentNote', () => {
  it('inserts a note tagged to her, entry-scoped', async () => {
    const chain = makeChain({ data: { id: 'n1' }, error: null });
    supabase.from.mockReturnValue(chain);

    const result = await submitContentNote('e1', 'hospital scenes');

    expect(supabase.from).toHaveBeenCalledWith('archive_content_notes');
    expect(chain.insert).toHaveBeenCalledWith({
      entry_id: 'e1',
      label: 'hospital scenes',
      created_by: 'user-1',
    });
    expect(result).toEqual({ data: { id: 'n1' }, error: null });
  });

  it('tells her to agree instead of duplicating an existing note (23505)', async () => {
    const chain = makeChain({ data: null, error: { code: '23505', message: 'dup' } });
    supabase.from.mockReturnValue(chain);
    const result = await submitContentNote('e1', 'hospital scenes');
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/agree/i);
  });

  it('refuses to write without a real session', async () => {
    signedOut();
    const result = await submitContentNote('e1', 'hospital scenes');
    expect(result.error).toMatch(/sign in/i);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('never reports success on a 200 that wrote zero rows', async () => {
    const chain = makeChain({ data: null, error: null });
    supabase.from.mockReturnValue(chain);
    const result = await submitContentNote('e1', 'hospital scenes');
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('submitEntry / submitEdit — the edge-function half', () => {
  beforeEach(() => {
    (callEdgeFunction as jest.Mock).mockReset();
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  });

  it('sends a new entry to archive-submit-entry', async () => {
    (callEdgeFunction as jest.Mock).mockResolvedValue({ data: { entry_id: 'e9' }, error: null });
    const res = await submitEntry({ title: 'Bound', media_type: 'film', release_year: 1996 });
    expect(callEdgeFunction).toHaveBeenCalledWith('archive-submit-entry', {
      title: 'Bound', media_type: 'film', release_year: 1996,
    });
    expect(res.error).toBeNull();
  });

  it('sends an edit to archive-submit-edit with the entry it is about', async () => {
    (callEdgeFunction as jest.Mock).mockResolvedValue({ data: { revision_id: 'r1' }, error: null });
    const res = await submitEdit('e1', { length_label: '1h 48m' });
    expect(callEdgeFunction).toHaveBeenCalledWith('archive-submit-edit', {
      entry_id: 'e1', patch: { length_label: '1h 48m' },
    });
    expect(res.error).toBeNull();
  });

  it('surfaces the edge function error rather than a success', async () => {
    // callEdgeFunction returns {data, error} and never throws. Treating a
    // resolved promise as success is how this app once told women a report was
    // filed when it was not.
    (callEdgeFunction as jest.Mock).mockResolvedValue({ data: null, error: 'Approved members only' });
    const res = await submitEntry({ title: 'Bound', media_type: 'film' });
    expect(res.data).toBeNull();
    expect(res.error).toBe('Approved members only');
  });

  it('treats a 200 with no payload as a failure, not a quiet success', async () => {
    (callEdgeFunction as jest.Mock).mockResolvedValue({ data: null, error: null });
    const res = await submitEdit('e1', { title: 'x' });
    expect(res.data).toBeNull();
    expect(res.error).toBeTruthy();
  });

  it('refuses an empty edit instead of queueing a revision that changes nothing', async () => {
    const res = await submitEdit('e1', {});
    expect(res.error).toBeTruthy();
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });
});
