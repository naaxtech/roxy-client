import {
  fetchNotifications, fetchNotificationsResult, fetchArchivedNotifications,
  markNotificationRead, markAllNotificationsRead, countUnread,
  clearNotifications, clearNotificationsUpTo, restoreNotifications,
  ARCHIVE_BATCH, CLEAR_ALL_MAX_CALLS,
  fetchUnreadNotificationCount,
  RoxyNotification,
} from '../lib/notifications';

jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../lib/errorLogger', () => ({ logError: jest.fn() }));
const { supabase } = jest.requireMock('../lib/supabase');
const { logError } = jest.requireMock('../lib/errorLogger');
const rpc = supabase.rpc as jest.Mock;

const row = (over: Partial<RoxyNotification> = {}): RoxyNotification => ({
  id: 'n1', type: 'friend_request', title: 't', body: null, link_path: null,
  created_at: '2026-07-18T00:00:00Z', read_at: null, archived_at: null, ...over,
});

type Call = [method: string, args: unknown[]];

/**
 * A PostgREST query builder stand-in: every method records its call and
 * returns the same builder, and awaiting it resolves to `result`. The order of
 * filters is therefore free, and the assertions read the recorded calls — the
 * query the code actually built — rather than a hand-shaped chain.
 */
function builder(result: unknown) {
  const calls: Call[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'update', 'eq', 'is', 'not', 'in', 'order', 'limit']) {
    b[m] = jest.fn((...args: unknown[]) => { calls.push([m, args]); return b; });
  }
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return { b, calls };
}

/** Queue one builder per `supabase.from()` call, in order. */
function queue(...results: unknown[]) {
  const built = results.map((r) => builder(r));
  const from = supabase.from as jest.Mock;
  built.forEach(({ b }) => from.mockReturnValueOnce(b));
  return built.map((x) => x.calls);
}

const has = (calls: Call[], method: string, ...args: unknown[]) =>
  calls.some(([m, a]) => m === method && JSON.stringify(a) === JSON.stringify(args));

/** `count` ids, `${prefix}0` … */
const idList = (count: number, prefix = 'n') => Array.from({ length: count }, (_, i) => `${prefix}${i}`);
/** archive_notifications' reply for these ids: every even one was unread. */
const archived = (ids: string[]) => ids.map((id, i) => ({ id, was_unread: i % 2 === 0 }));
const asCleared = (ids: string[]) => ids.map((id, i) => ({ id, wasUnread: i % 2 === 0 }));

beforeEach(() => {
  (supabase.from as jest.Mock).mockReset();
  rpc.mockReset();
  (logError as jest.Mock).mockClear();
});

describe('clearNotifications (RPC archive_notifications by id)', () => {
  it('sends the ids in the body and reports which rows were unread', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ id: 'n1', was_unread: true }, { id: 'n2', was_unread: false }], error: null,
    });
    await expect(clearNotifications(['n1', 'n2'])).resolves.toEqual({
      ok: true,
      cleared: [{ id: 'n1', wasUnread: true }, { id: 'n2', wasUnread: false }],
    });
    // One atomic write: no table update beside it, and exactly one selector.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('archive_notifications', { p_ids: ['n1', 'n2'] });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('zero rows is not a failure: the row was already gone (a retracted request, an un-react)', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(clearNotifications(['n1'])).resolves.toEqual({ ok: true, cleared: [] });
    expect(logError).not.toHaveBeenCalled();
  });

  it('an RPC error is a failure, and is logged', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    await expect(clearNotifications(['n1'])).resolves.toEqual({ ok: false });
    expect(logError).toHaveBeenCalledWith({ message: 'permission denied' }, 'notifications.clear');
  });

  it('a throw is a failure', async () => {
    rpc.mockImplementationOnce(() => { throw new Error('offline'); });
    await expect(clearNotifications(['n1'])).resolves.toEqual({ ok: false });
  });

  it('an answer that is not a row list is a failure, never a silent success', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(clearNotifications(['n1'])).resolves.toEqual({ ok: false });
  });

  it('nothing to clear writes nothing', async () => {
    await expect(clearNotifications([])).resolves.toEqual({ ok: true, cleared: [] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('by id is one call even when 500 come back: only Clear all goes again', async () => {
    const ids = idList(500);
    rpc.mockResolvedValueOnce({ data: archived(ids), error: null });
    await expect(clearNotifications(ids)).resolves.toEqual({ ok: true, cleared: asCleared(ids) });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('clearNotificationsUpTo (RPC archive_notifications, Clear all, 500 a call)', () => {
  const upTo = '2026-10-26T09:00:00.123456+00:00';

  it('the server takes 500 a call and Undo restores 500 a call', () => {
    expect(ARCHIVE_BATCH).toBe(500);
    expect(CLEAR_ALL_MAX_CALLS).toBe(40);
  });

  it('sends only p_up_to, so nothing newer than her screen is archived unseen', async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: 'n1', was_unread: true }], error: null });
    await expect(clearNotificationsUpTo(upTo)).resolves.toEqual({
      ok: true, cleared: [{ id: 'n1', wasUnread: true }], more: false,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('archive_notifications', { p_up_to: upTo });
  });

  it('a full batch calls again with the same p_up_to until a call returns fewer, and returns every row', async () => {
    const ids = idList(1003);
    rpc
      .mockResolvedValueOnce({ data: archived(ids.slice(0, 500)), error: null })
      .mockResolvedValueOnce({ data: archived(ids.slice(500, 1000)), error: null })
      .mockResolvedValueOnce({ data: archived(ids.slice(1000)), error: null });
    const result = await clearNotificationsUpTo(upTo);
    expect(rpc).toHaveBeenCalledTimes(3);
    rpc.mock.calls.forEach((call) => expect(call).toEqual(['archive_notifications', { p_up_to: upTo }]));
    expect(result).toEqual({
      ok: true,
      cleared: [
        ...asCleared(ids.slice(0, 500)), ...asCleared(ids.slice(500, 1000)), ...asCleared(ids.slice(1000)),
      ],
      more: false,
    });
  });

  it('exactly 500 then nothing: two calls, done', async () => {
    const ids = idList(500);
    rpc
      .mockResolvedValueOnce({ data: archived(ids), error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    await expect(clearNotificationsUpTo(upTo)).resolves.toEqual({ ok: true, cleared: asCleared(ids), more: false });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('stops after 40 calls (20,000 rows) and says some may remain', async () => {
    let call = 0;
    rpc.mockImplementation(async () => {
      const ids = idList(500, `c${call}-`);
      call += 1;
      return { data: archived(ids), error: null };
    });
    const result = await clearNotificationsUpTo(upTo);
    expect(rpc).toHaveBeenCalledTimes(40);
    expect(result.ok).toBe(true);
    expect(result.cleared).toHaveLength(20_000);
    expect(result).toEqual(expect.objectContaining({ more: true }));
  });

  it('zero rows is not a failure', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(clearNotificationsUpTo(upTo)).resolves.toEqual({ ok: true, cleared: [], more: false });
  });

  it('an RPC error on the first call is a failure with nothing cleared', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(clearNotificationsUpTo(upTo)).resolves.toEqual({ ok: false, cleared: [] });
    expect(logError).toHaveBeenCalledWith({ message: 'boom' }, 'notifications.clearAll');
  });

  it('a failure part-way stops, and returns the rows that landed: they stay archived, and Undo can restore exactly those', async () => {
    const ids = idList(500);
    rpc
      .mockResolvedValueOnce({ data: archived(ids), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });
    await expect(clearNotificationsUpTo(upTo)).resolves.toEqual({ ok: false, cleared: asCleared(ids) });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('a throw part-way is the same partial failure', async () => {
    const ids = idList(500);
    rpc
      .mockResolvedValueOnce({ data: archived(ids), error: null })
      .mockImplementationOnce(() => { throw new Error('offline'); });
    await expect(clearNotificationsUpTo(upTo)).resolves.toEqual({ ok: false, cleared: asCleared(ids) });
  });
});

describe('restoreNotifications (RPC unarchive_notifications, Undo and Restore)', () => {
  it('sends the ids and the ones to put back unread, and returns the count restored', async () => {
    rpc.mockResolvedValueOnce({ data: 2, error: null });
    await expect(restoreNotifications(['n1', 'n2'], ['n1'])).resolves.toEqual({ ok: true, restored: 2 });
    expect(rpc).toHaveBeenCalledWith('unarchive_notifications', { p_ids: ['n1', 'n2'], p_mark_unread: ['n1'] });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('a Restore from the archive marks nothing unread by default', async () => {
    rpc.mockResolvedValueOnce({ data: 1, error: null });
    await restoreNotifications(['a1']);
    expect(rpc).toHaveBeenCalledWith('unarchive_notifications', { p_ids: ['a1'], p_mark_unread: [] });
  });

  it('p_mark_unread stays a subset of p_ids', async () => {
    rpc.mockResolvedValueOnce({ data: 1, error: null });
    await restoreNotifications(['n1'], ['n1', 'n9']);
    expect(rpc).toHaveBeenCalledWith('unarchive_notifications', { p_ids: ['n1'], p_mark_unread: ['n1'] });
  });

  it('a short count is a success that says how many came back (the rest were deleted meanwhile)', async () => {
    rpc.mockResolvedValueOnce({ data: 0, error: null });
    await expect(restoreNotifications(['n1'])).resolves.toEqual({ ok: true, restored: 0 });
    expect(logError).not.toHaveBeenCalled();
  });

  it('an RPC error is a failure, and is logged', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(restoreNotifications(['n1'])).resolves.toEqual({ ok: false, restored: 0, unrestored: ['n1'] });
    expect(logError).toHaveBeenCalledWith({ message: 'boom' }, 'notifications.restore');
  });

  it('a throw is a failure', async () => {
    rpc.mockImplementationOnce(() => { throw new Error('offline'); });
    await expect(restoreNotifications(['n1'])).resolves.toEqual({ ok: false, restored: 0, unrestored: ['n1'] });
  });

  it('an answer that is not a count is a failure', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(restoreNotifications(['n1'])).resolves.toEqual({ ok: false, restored: 0, unrestored: ['n1'] });
  });

  it('more than 500 ids go 500 a call, each call with its own unread ids, and the counts add up', async () => {
    const ids = idList(1203);
    const unread = [ids[0], ids[499], ids[500], ids[1202]];
    rpc
      .mockResolvedValueOnce({ data: 500, error: null })
      .mockResolvedValueOnce({ data: 499, error: null })
      .mockResolvedValueOnce({ data: 203, error: null });
    await expect(restoreNotifications(ids, unread)).resolves.toEqual({ ok: true, restored: 1202 });
    expect(rpc.mock.calls).toEqual([
      ['unarchive_notifications', { p_ids: ids.slice(0, 500), p_mark_unread: [ids[0], ids[499]] }],
      ['unarchive_notifications', { p_ids: ids.slice(500, 1000), p_mark_unread: [ids[500]] }],
      ['unarchive_notifications', { p_ids: ids.slice(1000), p_mark_unread: [ids[1202]] }],
    ]);
  });

  it('a failed call part-way stops, and says how many came back and which ids did not', async () => {
    const ids = idList(1001);
    rpc
      .mockResolvedValueOnce({ data: 500, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });
    await expect(restoreNotifications(ids)).resolves.toEqual({
      ok: false, restored: 500, unrestored: ids.slice(500),
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('nothing to restore writes nothing', async () => {
    await expect(restoreNotifications([])).resolves.toEqual({ ok: true, restored: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('fetchNotifications', () => {
  it('returns rows on success', async () => {
    queue({ data: [row()], error: null });
    await expect(fetchNotifications('me')).resolves.toHaveLength(1);
  });

  it('returns [] on error (migration not applied yet)', async () => {
    queue({ data: null, error: { message: 'missing' } });
    await expect(fetchNotifications('me')).resolves.toEqual([]);
  });

  it('reads only her rows that are not archived, newest first, 50 at most', async () => {
    const [calls] = queue({ data: [], error: null });
    await fetchNotifications('me');
    expect(supabase.from).toHaveBeenCalledWith('notifications');
    expect(has(calls, 'eq', 'user_id', 'me')).toBe(true);
    expect(has(calls, 'is', 'archived_at', null)).toBe(true);
    expect(has(calls, 'order', 'created_at', { ascending: false })).toBe(true);
    expect(has(calls, 'limit', 50)).toBe(true);
  });
});

describe('fetchNotificationsResult (the screen reports a failed load)', () => {
  it('ok with the rows on success', async () => {
    queue({ data: [row()], error: null });
    await expect(fetchNotificationsResult('me')).resolves.toEqual({ ok: true, items: [row()] });
  });

  it('not ok when PostgREST returns an error', async () => {
    queue({ data: null, error: { message: 'column archived_at does not exist' } });
    await expect(fetchNotificationsResult('me')).resolves.toEqual({ ok: false });
  });

  it('not ok when the request throws', async () => {
    (supabase.from as jest.Mock).mockImplementationOnce(() => { throw new Error('offline'); });
    await expect(fetchNotificationsResult('me')).resolves.toEqual({ ok: false });
  });

  it('applies the archived filter', async () => {
    const [calls] = queue({ data: [], error: null });
    await fetchNotificationsResult('me');
    expect(has(calls, 'is', 'archived_at', null)).toBe(true);
  });
});

describe('fetchArchivedNotifications', () => {
  it('reads only archived rows, most recently cleared first, 50 at most', async () => {
    const archived = row({ archived_at: '2026-07-19T00:00:00Z', read_at: '2026-07-19T00:00:00Z' });
    const [calls] = queue({ data: [archived], error: null });
    await expect(fetchArchivedNotifications('me')).resolves.toEqual({ ok: true, items: [archived] });
    expect(has(calls, 'eq', 'user_id', 'me')).toBe(true);
    expect(has(calls, 'not', 'archived_at', 'is', null)).toBe(true);
    expect(has(calls, 'order', 'archived_at', { ascending: false })).toBe(true);
    expect(has(calls, 'limit', 50)).toBe(true);
  });

  it('not ok on error', async () => {
    queue({ data: null, error: { message: 'boom' } });
    await expect(fetchArchivedNotifications('me')).resolves.toEqual({ ok: false });
  });
});

describe('fetchUnreadNotificationCount', () => {
  it('counts unread rows that are not archived', async () => {
    const [calls] = queue({ count: 3, error: null });
    await expect(fetchUnreadNotificationCount('me')).resolves.toBe(3);
    expect(has(calls, 'select', 'id', { count: 'exact', head: true })).toBe(true);
    expect(has(calls, 'eq', 'user_id', 'me')).toBe(true);
    expect(has(calls, 'is', 'read_at', null)).toBe(true);
    expect(has(calls, 'is', 'archived_at', null)).toBe(true);
  });

  it('0 on error', async () => {
    queue({ count: null, error: { message: 'boom' } });
    await expect(fetchUnreadNotificationCount('me')).resolves.toBe(0);
  });
});

describe('mark read', () => {
  it('markNotificationRead updates the row by id', async () => {
    const [calls] = queue({ error: null });
    await markNotificationRead('n1');
    const update = calls.find(([m]) => m === 'update');
    expect(update?.[1][0]).toEqual(expect.objectContaining({ read_at: expect.any(String) }));
    expect(has(calls, 'eq', 'id', 'n1')).toBe(true);
  });

  it('markAllNotificationsRead updates unread rows for the user', async () => {
    const [calls] = queue({ error: null });
    await markAllNotificationsRead('me');
    expect(has(calls, 'eq', 'user_id', 'me')).toBe(true);
    expect(has(calls, 'is', 'read_at', null)).toBe(true);
  });
});

describe('countUnread', () => {
  it('counts rows without read_at', () => {
    expect(countUnread([row(), row({ id: 'n2', read_at: '2026-07-18T01:00:00Z' })])).toBe(1);
  });
});
