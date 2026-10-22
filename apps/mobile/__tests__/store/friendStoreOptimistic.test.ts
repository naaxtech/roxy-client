import { useFriendStore, type FriendshipRow } from '../../store/friendStore';

/**
 * F10 (motion spec §2): every friend action changes the screen in the same
 * frame as the tap, before any request resolves, and a refused write rolls
 * back and throws so the screen can say so with a Retry.
 *
 * "Same frame" at store level = the state has flipped by the time the action
 * returns its promise (zustand `set` is synchronous; the action runs up to its
 * first `await` before returning). The writes here never resolve, so nothing
 * but the optimistic step can have changed the state.
 */

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
    auth: { getUser: jest.fn() },
  },
}));
jest.mock('../../lib/analytics', () => ({
  Analytics: new Proxy({}, { get: () => jest.fn() }),
}));

const { supabase } = jest.requireMock('../../lib/supabase');

const NEVER = () => new Promise(() => undefined);
const ME = 'user-me';

const profile = (id: string, name: string) => ({
  id, display_name: name, username: name.toLowerCase(), avatar_url: null, last_seen_at: null,
});
const row = (id: string, requester: string, addressee: string, status: FriendshipRow['status'], who: ReturnType<typeof profile>): FriendshipRow => ({
  id, requester_id: requester, addressee_id: addressee, status, created_at: '2026-10-01T00:00:00Z', profile: who,
});

/** A chain whose every terminal call never settles: the write is "in flight" forever. */
const hangingChain = () => {
  const chain: Record<string, jest.Mock> = {};
  for (const k of ['insert', 'update', 'delete', 'select', 'eq', 'or']) chain[k] = jest.fn(() => chain);
  chain.then = jest.fn(); // thenable that never calls back
  chain.insert = jest.fn(NEVER);
  chain.eq = jest.fn(NEVER);
  return chain;
};

/** A chain whose write is refused by the server. */
const refusingChain = () => {
  const refused = { error: { code: '42501', message: 'policy text' } };
  const chain: Record<string, jest.Mock> = {};
  chain.insert = jest.fn(() => Promise.resolve(refused));
  chain.update = jest.fn(() => chain);
  chain.delete = jest.fn(() => chain);
  chain.eq = jest.fn(() => Promise.resolve(refused));
  chain.select = jest.fn(() => chain);
  chain.or = jest.fn(() => Promise.resolve({ data: [], error: null }));
  return chain;
};

const alice = profile('user-alice', 'Alice');
const bob = profile('user-bob', 'Bob');

beforeEach(() => {
  supabase.from.mockReset();
  supabase.auth.getUser.mockReset();
  useFriendStore.setState({
    friends: [row('f-alice', 'user-alice', ME, 'accepted', alice)],
    pendingReceived: [row('f-bob', 'user-bob', ME, 'pending', bob)],
    pendingSent: [],
    pendingCount: 1,
    _userId: ME,
    _lastHeartbeat: Date.now(),
  });
});

describe('friendStore is optimistic (F10)', () => {
  it('sendRequest shows "Requested" before the insert resolves', () => {
    supabase.from.mockReturnValue(hangingChain());
    void useFriendStore.getState().sendRequest('user-carol');
    const sent = useFriendStore.getState().pendingSent;
    expect(sent.map((r) => r.profile.id)).toEqual(['user-carol']);
    expect(sent[0].requester_id).toBe(ME);
  });

  it('sendRequest flips even on a cold store, before the session lookup answers', () => {
    useFriendStore.setState({ _userId: null });
    supabase.auth.getUser.mockImplementation(NEVER);
    void useFriendStore.getState().sendRequest('user-carol');
    expect(useFriendStore.getState().pendingSent.map((r) => r.profile.id)).toEqual(['user-carol']);
  });

  it('sendRequest rolls back and throws when the server refuses', async () => {
    supabase.from.mockReturnValue(refusingChain());
    await expect(useFriendStore.getState().sendRequest('user-carol')).rejects.toBeTruthy();
    expect(useFriendStore.getState().pendingSent).toEqual([]);
  });

  it('sendRequest rolls back when nobody is signed in', async () => {
    useFriendStore.setState({ _userId: null });
    supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(useFriendStore.getState().sendRequest('user-carol')).rejects.toThrow(/signed in/i);
    expect(useFriendStore.getState().pendingSent).toEqual([]);
  });

  it('sendRequest to a woman who already asked accepts hers, at once', () => {
    supabase.from.mockReturnValue(hangingChain());
    void useFriendStore.getState().sendRequest('user-bob');
    const st = useFriendStore.getState();
    expect(st.pendingReceived).toEqual([]);
    expect(st.friends.map((f) => f.profile.id)).toContain('user-bob');
    expect(st.pendingSent).toEqual([]);
    expect(st.pendingCount).toBe(0);
  });

  it('acceptRequest moves her to friends before the update resolves', () => {
    supabase.from.mockReturnValue(hangingChain());
    void useFriendStore.getState().acceptRequest('f-bob');
    const st = useFriendStore.getState();
    expect(st.pendingReceived).toEqual([]);
    expect(st.pendingCount).toBe(0);
    const bobRow = st.friends.find((f) => f.id === 'f-bob');
    expect(bobRow?.status).toBe('accepted');
    expect(bobRow?.profile.id).toBe('user-bob');
  });

  it('acceptRequest puts the request back where it was when refused', async () => {
    supabase.from.mockReturnValue(refusingChain());
    await expect(useFriendStore.getState().acceptRequest('f-bob')).rejects.toBeTruthy();
    const st = useFriendStore.getState();
    expect(st.pendingReceived.map((r) => r.id)).toEqual(['f-bob']);
    expect(st.friends.map((f) => f.id)).toEqual(['f-alice']);
    expect(st.pendingCount).toBe(1);
  });

  it.each([
    ['rejectRequest', 'f-bob', 'pendingReceived'],
    ['unfriend', 'f-alice', 'friends'],
  ] as const)('%s removes the row at once and restores it when refused', async (action, id, list) => {
    supabase.from.mockReturnValue(hangingChain());
    void useFriendStore.getState()[action](id);
    expect(useFriendStore.getState()[list].some((r) => r.id === id)).toBe(false);

    // Same action, refused this time, from the original state.
    useFriendStore.setState({
      friends: [row('f-alice', 'user-alice', ME, 'accepted', alice)],
      pendingReceived: [row('f-bob', 'user-bob', ME, 'pending', bob)],
      pendingCount: 1,
    });
    supabase.from.mockReturnValue(refusingChain());
    await expect(useFriendStore.getState()[action](id)).rejects.toBeTruthy();
    expect(useFriendStore.getState()[list].some((r) => r.id === id)).toBe(true);
    expect(useFriendStore.getState().pendingCount).toBe(1);
  });

  it('cancelRequest removes her sent request at once and restores it when refused', async () => {
    const carol = profile('user-carol', 'Carol');
    useFriendStore.setState({ pendingSent: [row('f-carol', ME, 'user-carol', 'pending', carol)] });
    supabase.from.mockReturnValue(hangingChain());
    void useFriendStore.getState().cancelRequest('f-carol');
    expect(useFriendStore.getState().pendingSent).toEqual([]);

    useFriendStore.setState({ pendingSent: [row('f-carol', ME, 'user-carol', 'pending', carol)] });
    supabase.from.mockReturnValue(refusingChain());
    await expect(useFriendStore.getState().cancelRequest('f-carol')).rejects.toBeTruthy();
    expect(useFriendStore.getState().pendingSent.map((r) => r.id)).toEqual(['f-carol']);
  });

  it('a rollback leaves rows that changed meanwhile alone', async () => {
    // Bob is accepted optimistically; while that write is in flight a refetch
    // brings Dana in. Bob's rollback must not erase Dana.
    let refuse: (v: unknown) => void = () => undefined;
    const chain = refusingChain();
    chain.eq = jest.fn(() => new Promise((r) => { refuse = r; }));
    supabase.from.mockReturnValue(chain);
    const p = useFriendStore.getState().acceptRequest('f-bob');
    const dana = profile('user-dana', 'Dana');
    useFriendStore.setState((st) => ({ friends: [...st.friends, row('f-dana', 'user-dana', ME, 'accepted', dana)] }));
    refuse({ error: { code: '42501', message: 'x' } });
    await expect(p).rejects.toBeTruthy();
    expect(useFriendStore.getState().friends.map((f) => f.id).sort()).toEqual(['f-alice', 'f-dana']);
    expect(useFriendStore.getState().pendingReceived.map((r) => r.id)).toEqual(['f-bob']);
  });
});
