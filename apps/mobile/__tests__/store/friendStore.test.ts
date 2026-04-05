import { act, renderHook } from '@testing-library/react-native';
import { useFriendStore, isOnline, sortByPresence, FriendshipRow } from '../../store/friendStore';

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const { supabase } = jest.requireMock('../../lib/supabase');

const mkProfile = (id: string, name: string) => ({
  id, display_name: name, username: name.toLowerCase().replace(' ', ''), avatar_url: null, last_seen_at: null,
});

const mkRow = (
  id: string, requesterId: string, addresseeId: string, status: string,
  requesterProfile: any, addresseeProfile: any,
) => ({
  id, requester_id: requesterId, addressee_id: addresseeId, status,
  created_at: new Date().toISOString(),
  requester: requesterProfile,
  addressee: addresseeProfile,
});

describe('friendStore', () => {
  beforeEach(() => {
    useFriendStore.setState({
      friends: [], pendingReceived: [], pendingSent: [], _userId: null,
      _lastHeartbeat: Date.now(),
    });
    jest.clearAllMocks();
  });

  it('initialises with empty state', () => {
    const { result } = renderHook(() => useFriendStore());
    expect(result.current.friends).toEqual([]);
    expect(result.current.pendingReceived).toEqual([]);
    expect(result.current.pendingSent).toEqual([]);
    expect(result.current.pendingCount).toBe(0);
  });

  it('fetchAll splits rows into friends / pendingReceived / pendingSent', async () => {
    const ME = 'user-me';
    const alice = mkProfile('user-alice', 'Alice');
    const bob   = mkProfile('user-bob',   'Bob');
    const carol = mkProfile('user-carol', 'Carol');
    const me    = mkProfile(ME, 'Me');

    const rows = [
      mkRow('f1', alice.id, ME, 'accepted', alice, me),  // accepted — Alice requested me
      mkRow('f2', bob.id,   ME, 'pending',  bob,   me),  // pending received — Bob requested me
      mkRow('f3', ME, carol.id, 'pending',  me,   carol), // pending sent — I requested Carol
    ];

    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      or: jest.fn().mockResolvedValue({ data: rows, error: null }),
    });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.fetchAll(ME); });

    // friends: Alice (addressee_id = ME so requester = Alice is the other person)
    expect(result.current.friends).toHaveLength(1);
    expect(result.current.friends[0].profile.id).toBe(alice.id);

    // pendingReceived: Bob
    expect(result.current.pendingReceived).toHaveLength(1);
    expect(result.current.pendingReceived[0].id).toBe('f2');
    expect(result.current.pendingReceived[0].profile.id).toBe(bob.id);

    // pendingSent: Carol
    expect(result.current.pendingSent).toHaveLength(1);
    expect(result.current.pendingSent[0].id).toBe('f3');
    expect(result.current.pendingSent[0].profile.id).toBe(carol.id);

    expect(result.current.pendingCount).toBe(1);
  });

  it('fetchAll handles null data gracefully', async () => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      or: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.fetchAll('user-me'); });
    expect(result.current.friends).toEqual([]);
    expect(result.current.pendingCount).toBe(0);
  });

  it('sendRequest inserts and refreshes state', async () => {
    const ME = 'user-me';
    const carol = mkProfile('user-carol', 'Carol');
    useFriendStore.setState({ _userId: ME });

    const insertMock = jest.fn().mockResolvedValue({ error: null });
    const orMock = jest.fn().mockResolvedValue({
      data: [mkRow('f-new', ME, carol.id, 'pending', mkProfile(ME, 'Me'), carol)],
      error: null,
    });
    supabase.from
      .mockReturnValueOnce({ insert: insertMock })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: orMock });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.sendRequest(carol.id); });

    expect(insertMock).toHaveBeenCalledWith({ requester_id: ME, addressee_id: carol.id });
    expect(result.current.pendingSent).toHaveLength(1);
    expect(result.current.pendingSent[0].profile.id).toBe(carol.id);
  });

  it('sendRequest swallows 23505 duplicate key error', async () => {
    useFriendStore.setState({ _userId: 'user-me' });
    supabase.from
      .mockReturnValueOnce({
        insert: jest.fn().mockResolvedValue({ error: { code: '23505', message: 'dup' } }),
      })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: jest.fn().mockResolvedValue({ data: [], error: null }) });

    const { result } = renderHook(() => useFriendStore());
    await expect(
      act(async () => { await result.current.sendRequest('user-other'); })
    ).resolves.not.toThrow();
  });

  it('acceptRequest updates status to accepted and refreshes', async () => {
    useFriendStore.setState({ _userId: 'user-me' });
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from
      .mockReturnValueOnce({ update: jest.fn().mockReturnValue({ eq: eqMock }) })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: jest.fn().mockResolvedValue({ data: [], error: null }) });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.acceptRequest('friendship-1'); });

    expect(eqMock).toHaveBeenCalledWith('id', 'friendship-1');
  });

  it('rejectRequest deletes the row and refreshes', async () => {
    useFriendStore.setState({ _userId: 'user-me' });
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from
      .mockReturnValueOnce({ delete: jest.fn().mockReturnValue({ eq: eqMock }) })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: jest.fn().mockResolvedValue({ data: [], error: null }) });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.rejectRequest('friendship-1'); });

    expect(eqMock).toHaveBeenCalledWith('id', 'friendship-1');
  });

  it('cancelRequest deletes the row and refreshes', async () => {
    useFriendStore.setState({ _userId: 'user-me' });
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from
      .mockReturnValueOnce({ delete: jest.fn().mockReturnValue({ eq: eqMock }) })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: jest.fn().mockResolvedValue({ data: [], error: null }) });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.cancelRequest('friendship-1'); });

    expect(eqMock).toHaveBeenCalledWith('id', 'friendship-1');
  });

  it('unfriend deletes the row and refreshes', async () => {
    useFriendStore.setState({ _userId: 'user-me' });
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from
      .mockReturnValueOnce({ delete: jest.fn().mockReturnValue({ eq: eqMock }) })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: jest.fn().mockResolvedValue({ data: [], error: null }) });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.unfriend('friendship-1'); });

    expect(eqMock).toHaveBeenCalledWith('id', 'friendship-1');
  });

  describe('isOnline', () => {
    it('returns true when last_seen_at is within 5 minutes', () => {
      const recent = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      expect(isOnline(recent)).toBe(true);
    });

    it('returns false when last_seen_at is older than 5 minutes', () => {
      const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      expect(isOnline(old)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isOnline(null)).toBe(false);
    });
  });

  describe('sortByPresence', () => {
    it('puts most-recently-seen friends first', () => {
      const online  = { profile: { last_seen_at: new Date(Date.now() - 1 * 60 * 1000).toISOString() } } as FriendshipRow;
      const recent  = { profile: { last_seen_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() } } as FriendshipRow;
      const offline = { profile: { last_seen_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() } } as FriendshipRow;
      const sorted = sortByPresence([offline, online, recent]);
      expect(sorted[0]).toBe(online);
      expect(sorted[1]).toBe(recent);
      expect(sorted[2]).toBe(offline);
    });

    it('puts null last_seen_at friends last', () => {
      const online  = { profile: { last_seen_at: new Date().toISOString() } } as FriendshipRow;
      const nullOne = { profile: { last_seen_at: null } } as FriendshipRow;
      const sorted = sortByPresence([nullOne, online]);
      expect(sorted[0]).toBe(online);
      expect(sorted[1]).toBe(nullOne);
    });

    it('does not mutate the original array', () => {
      const arr = [
        { profile: { last_seen_at: null } } as FriendshipRow,
        { profile: { last_seen_at: new Date().toISOString() } } as FriendshipRow,
      ];
      const original = [...arr];
      sortByPresence(arr);
      expect(arr[0]).toBe(original[0]);
    });
  });

  describe('fetchAll heartbeat', () => {
    it('writes last_seen_at on first call (_lastHeartbeat = 0)', async () => {
      useFriendStore.setState({ _lastHeartbeat: 0, _userId: null });

      const eqMock = jest.fn().mockResolvedValue({ error: null });
      const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
      const orMock = jest.fn().mockResolvedValue({ data: [], error: null });

      supabase.from
        .mockReturnValueOnce({ update: updateMock })
        .mockReturnValue({ select: jest.fn().mockReturnThis(), or: orMock });

      const { result } = renderHook(() => useFriendStore());
      await act(async () => { await result.current.fetchAll('user-me'); });

      expect(updateMock).toHaveBeenCalledWith({ last_seen_at: expect.any(String) });
      expect(eqMock).toHaveBeenCalledWith('id', 'user-me');
      expect(result.current._lastHeartbeat).toBeGreaterThan(0);
    });

    it('skips the write when called within 5 minutes', async () => {
      const recentBeat = Date.now() - 2 * 60 * 1000; // 2 min ago
      useFriendStore.setState({ _lastHeartbeat: recentBeat, _userId: null });

      const updateMock = jest.fn();
      const orMock = jest.fn().mockResolvedValue({ data: [], error: null });

      supabase.from.mockReturnValue({
        update: updateMock,
        select: jest.fn().mockReturnThis(),
        or: orMock,
      });

      const { result } = renderHook(() => useFriendStore());
      await act(async () => { await result.current.fetchAll('user-me'); });

      expect(updateMock).not.toHaveBeenCalled();
      expect(result.current._lastHeartbeat).toBe(recentBeat);
    });
  });
});
