import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { snackbar, type SnackbarOptions } from '../../components/feedback/SnackbarHost';

/**
 * Clearing a notification archives it (plan 2026-10-26-notifications-clear-archive):
 * a clear button on each row and "Clear all" in the header remove rows at once,
 * the snackbar says so only after the write came back, Undo restores exactly
 * what was cleared (unread ones unread), a failed write puts the rows back with
 * Retry, and `?view=archived` lists what she cleared with Restore. A failed
 * load is an error state with Retry, not an empty inbox.
 *
 * Only an RPC error is a failure. Zero rows means the row was already gone (a
 * retracted request, an un-react): it leaves the screen without an error, and
 * never with a Retry that could only fail again.
 */

const mockPush = jest.fn();
const mockParams: { view?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
// Focus = mount here; the screen re-reads on every focus.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../../hooks/useThemeColors', () => ({
  useThemeColors: () => jest.requireActual('../../lib/theme').THEMES.light,
}));
jest.mock('../../store/authStore', () => {
  const state = { user: { id: 'u1' } };
  return { useAuthStore: () => state };
});
jest.mock('../../hooks/useAccess', () => ({ useAccess: () => ({ can: () => true }) }));
jest.mock('../../lib/notifications', () => ({
  fetchNotificationsResult: jest.fn(),
  fetchArchivedNotifications: jest.fn(),
  markNotificationRead: jest.fn(() => Promise.resolve()),
  markAllNotificationsRead: jest.fn(() => Promise.resolve()),
  clearNotifications: jest.fn(),
  clearNotificationsUpTo: jest.fn(),
  restoreNotifications: jest.fn(),
  countUnread: (l: { read_at: string | null }[]) => l.filter((n) => n.read_at === null).length,
}));

// eslint-disable-next-line import/first
import NotificationsScreen from '../../app/notifications';

const lib = jest.requireMock('../../lib/notifications') as Record<string, jest.Mock>;

type Cleared = { id: string; wasUnread: boolean };
type ClearResult = { ok: true; cleared: Cleared[] } | { ok: false };
type ClearAllResult = { ok: true; cleared: Cleared[]; more: boolean } | { ok: false; cleared: Cleared[] };
type RestoreResult =
  | { ok: true; restored: number }
  | { ok: false; restored: number; unrestored: string[] };

const now = new Date().toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
// n1 is unread and the newest; n2 is read.
const n1 = {
  id: 'n1', type: 'follow', title: 'Maya followed you', body: null,
  link_path: '/profile/maya', created_at: now, read_at: null, archived_at: null,
};
const n2 = {
  id: 'n2', type: 'comment', title: 'Bea commented', body: 'so true',
  link_path: '/post/p1', created_at: ago(60_000), read_at: now, archived_at: null,
};
const n3 = {
  id: 'n3', type: 'friend_accept', title: 'Lia accepted', body: null,
  link_path: null, created_at: ago(30_000), read_at: now, archived_at: null,
};
const a1 = {
  id: 'a1', type: 'post_reaction', title: 'Jo liked your post', body: null,
  link_path: '/post/p2', created_at: ago(120_000), read_at: now, archived_at: now,
};
const a2 = {
  id: 'a2', type: 'comment', title: 'Kit commented', body: null,
  link_path: null, created_at: ago(180_000), read_at: now, archived_at: ago(1_000),
};
// o1 is older than anything on her screen: the server still has it after a
// Clear all that stopped short.
const o1 = {
  id: 'o1', type: 'follow', title: 'Ren followed you', body: null,
  link_path: null, created_at: ago(86_400_000), read_at: now, archived_at: null,
};
const UNREAD = new Set(['n1']);
/** `count` read rows past the 50 on her screen, as Clear all reports them. */
const bulk = (count: number): Cleared[] =>
  Array.from({ length: count }, (_, i) => ({ id: `old${i}`, wasUnread: false }));
const LANDED_ON_SCREEN: Cleared[] = [{ id: 'n1', wasUnread: true }, { id: 'n2', wasUnread: false }];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let show: jest.SpyInstance<number, [SnackbarOptions]>;
const lastSnack = (): SnackbarOptions => show.mock.calls[show.mock.calls.length - 1][0];
const pull = (v: ReturnType<typeof render>) =>
  act(async () => { fireEvent(v.getByTestId('notifications-list'), 'refresh'); });

beforeEach(() => {
  jest.clearAllMocks();
  delete mockParams.view;
  show = jest.spyOn(snackbar, 'show');
  lib.fetchNotificationsResult.mockResolvedValue({ ok: true, items: [n1, n2] });
  lib.fetchArchivedNotifications.mockResolvedValue({ ok: true, items: [a1] });
  // The server's answer: every id archived, with the unread state it had.
  lib.clearNotifications.mockImplementation(async (ids: string[]): Promise<ClearResult> =>
    ({ ok: true, cleared: ids.map((id) => ({ id, wasUnread: UNREAD.has(id) })) }));
  lib.clearNotificationsUpTo.mockResolvedValue({
    ok: true, cleared: [{ id: 'n1', wasUnread: true }, { id: 'n2', wasUnread: false }], more: false,
  });
  lib.restoreNotifications.mockImplementation(async (ids: string[]): Promise<RestoreResult> =>
    ({ ok: true, restored: ids.length }));
});

afterEach(() => {
  show.mockRestore();
  act(() => { snackbar.dismiss(); });
});

describe('inbox', () => {
  it('lists rows with a labelled clear button on each', async () => {
    const v = render(<NotificationsScreen />);
    await v.findByTestId('notification-row-n1');
    expect(v.getByTestId('notifications-list')).toBeTruthy();
    expect(v.getByTestId('notification-row-n2')).toBeTruthy();
    const clear = v.getByTestId('notification-clear-n1');
    expect(clear.props.accessibilityLabel).toBe('Clear notification');
    expect(clear.props.accessibilityRole).toBe('button');
    // The web name: RN's Pressable folds `aria-label` into accessibilityLabel on
    // the native host, so read it off the element the screen rendered.
    expect(v.UNSAFE_getAllByProps({
      testID: 'notification-clear-n1', 'aria-label': 'Clear notification',
    }).length).toBeGreaterThan(0);
    expect(v.getAllByLabelText('Clear notification')).toHaveLength(2);
    expect(lib.fetchNotificationsResult).toHaveBeenCalledWith('u1');
    expect(lib.fetchArchivedNotifications).not.toHaveBeenCalled();
  });

  it('clearing a row removes it at once and says "Cleared" only after the write came back', async () => {
    const write = deferred<ClearResult>();
    lib.clearNotifications.mockReturnValueOnce(write.promise);
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-clear-n1'));
    expect(v.queryByTestId('notification-row-n1')).toBeNull();
    expect(lib.clearNotifications).toHaveBeenCalledWith(['n1']);
    expect(show).not.toHaveBeenCalled();
    await act(async () => { write.resolve({ ok: true, cleared: [{ id: 'n1', wasUnread: true }] }); });
    expect(lastSnack()).toEqual(expect.objectContaining({ message: 'Cleared', actionLabel: 'Undo' }));
    expect(v.queryByTestId('notification-row-n1')).toBeNull();
  });

  it('Undo restores the cleared row UNREAD, the way it was, and the unread count follows', async () => {
    const v = render(<NotificationsScreen />);
    await v.findByTestId('notification-row-n1');
    expect(v.getByText('Mark all read')).toBeTruthy();
    fireEvent.press(v.getByTestId('notification-clear-n1'));
    await waitFor(() => expect(show).toHaveBeenCalled());
    // n2 is read: with n1 cleared nothing is unread.
    expect(v.queryByText('Mark all read')).toBeNull();
    await act(async () => { lastSnack().onAction?.(); });
    expect(lib.restoreNotifications).toHaveBeenCalledWith(['n1'], ['n1']);
    expect(v.getByTestId('notification-row-n1')).toBeTruthy();
    expect(v.getByText('Mark all read')).toBeTruthy();
  });

  it('Undo of a row that was read keeps it read', async () => {
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-clear-n2'));
    await waitFor(() => expect(show).toHaveBeenCalled());
    await act(async () => { lastSnack().onAction?.(); });
    expect(lib.restoreNotifications).toHaveBeenCalledWith(['n2'], []);
    expect(v.getByTestId('notification-row-n2')).toBeTruthy();
  });

  it('a failed clear puts the row back and says so with Retry — never "Cleared"', async () => {
    lib.clearNotifications.mockResolvedValueOnce({ ok: false });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-clear-n1'));
    await waitFor(() => expect(v.getByTestId('notification-row-n1')).toBeTruthy());
    expect(show).toHaveBeenCalledTimes(1);
    expect(lastSnack().message).not.toBe('Cleared');
    expect(lastSnack().actionLabel).toBe('Retry');
  });

  it('clearing a row the server already deleted: it leaves quietly, no error, no Retry', async () => {
    const write = deferred<ClearResult>();
    lib.clearNotifications.mockReturnValueOnce(write.promise);
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-clear-n1'));
    await act(async () => { write.resolve({ ok: true, cleared: [] }); });
    expect(v.queryByTestId('notification-row-n1')).toBeNull();
    expect(v.getByTestId('notification-row-n2')).toBeTruthy();
    expect(show).not.toHaveBeenCalled();
  });

  it('a failed Undo takes the row back out and says so with Retry', async () => {
    lib.restoreNotifications.mockResolvedValueOnce({ ok: false });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-clear-n1'));
    await waitFor(() => expect(show).toHaveBeenCalled());
    await act(async () => { lastSnack().onAction?.(); });
    expect(v.queryByTestId('notification-row-n1')).toBeNull();
    expect(lastSnack().message).not.toBe('Cleared');
    expect(lastSnack().actionLabel).toBe('Retry');
  });

  it('Undo of a row deleted meanwhile: it leaves the list and says so, no Retry', async () => {
    lib.restoreNotifications.mockResolvedValueOnce({ ok: true, restored: 0 });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-clear-n1'));
    await waitFor(() => expect(show).toHaveBeenCalled());
    await act(async () => { lastSnack().onAction?.(); });
    expect(v.queryByTestId('notification-row-n1')).toBeNull();
    expect(lastSnack().message).toBe('That notification is no longer available');
    expect(lastSnack().actionLabel).toBeUndefined();
  });

  it('Clear all empties the list, then Undo brings every cleared id back, unread ones unread', async () => {
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notifications-clear-all'));
    expect(v.queryByTestId('notification-row-n1')).toBeNull();
    expect(v.queryByTestId('notification-row-n2')).toBeNull();
    await waitFor(() => expect(lastSnack()).toEqual(
      expect.objectContaining({ message: 'Cleared all', actionLabel: 'Undo' }),
    ));
    await act(async () => { lastSnack().onAction?.(); });
    expect(lib.restoreNotifications).toHaveBeenCalledWith(['n1', 'n2'], ['n1']);
    expect(v.getByTestId('notification-row-n1')).toBeTruthy();
    expect(v.getByTestId('notification-row-n2')).toBeTruthy();
    expect(v.getByText('Mark all read')).toBeTruthy();
  });

  it('Clear all archives only up to the newest row she has loaded, to the microsecond, whatever order it is in', async () => {
    // m1 and m2 share a millisecond, so the list's own sort (Date.parse) leaves
    // them as loaded, older first, and m3 (older still) sorts last: neither the
    // first row nor the last is the newest. Only the server's full string says.
    const m1 = { ...n2, id: 'm1', created_at: '2026-10-26T09:00:00.123100+00:00' };
    const m2 = { ...n1, id: 'm2', created_at: '2026-10-26T09:00:00.123900+00:00' };
    const m3 = { ...n3, id: 'm3', created_at: '2026-10-26T08:59:59.000000+00:00' };
    lib.fetchNotificationsResult.mockResolvedValue({ ok: true, items: [m1, m2, m3] });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notifications-clear-all'));
    expect(lib.clearNotificationsUpTo).toHaveBeenCalledTimes(1);
    expect(lib.clearNotificationsUpTo).toHaveBeenCalledWith(m2.created_at);
  });

  it('two taps on Clear all in one frame make one call', async () => {
    const write = deferred<ClearAllResult>();
    lib.clearNotificationsUpTo.mockReturnValueOnce(write.promise);
    const v = render(<NotificationsScreen />);
    const clearAll = await v.findByTestId('notifications-clear-all');
    // Both land before React re-renders the header.
    act(() => {
      fireEvent.press(clearAll);
      fireEvent.press(clearAll);
    });
    expect(lib.clearNotificationsUpTo).toHaveBeenCalledTimes(1);
    await act(async () => { write.resolve({ ok: true, cleared: LANDED_ON_SCREEN, more: false }); });
    expect(lib.clearNotificationsUpTo).toHaveBeenCalledTimes(1);
  });

  it('Clear all is disabled while one is in flight, even when a re-read brings it back', async () => {
    const write = deferred<ClearAllResult>();
    lib.clearNotificationsUpTo.mockReturnValueOnce(write.promise);
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notifications-clear-all'));
    // One arrived after her screen loaded: a re-read shows it, and Clear all with it.
    const fresh = { ...n3, id: 'n4', created_at: new Date(Date.now() + 5_000).toISOString() };
    lib.fetchNotificationsResult.mockResolvedValue({ ok: true, items: [fresh, n1, n2] });
    await pull(v);
    await v.findByTestId('notification-row-n4');
    const clearAll = v.getByTestId('notifications-clear-all');
    expect(clearAll.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    fireEvent.press(clearAll);
    expect(lib.clearNotificationsUpTo).toHaveBeenCalledTimes(1);
    await act(async () => { write.resolve({ ok: true, cleared: LANDED_ON_SCREEN, more: false }); });
    expect(v.getByTestId('notifications-clear-all').props.accessibilityState)
      .toEqual(expect.objectContaining({ disabled: false }));
  });

  it('a Clear all that fails part-way: what landed stays cleared with Undo for exactly those; the rest stay hers', async () => {
    const landed = [...LANDED_ON_SCREEN, ...bulk(498)];
    lib.clearNotificationsUpTo.mockResolvedValueOnce({ ok: false, cleared: landed });
    const v = render(<NotificationsScreen />);
    const clearAll = await v.findByTestId('notifications-clear-all');
    // The server: the first 500 archived, older ones still in her inbox.
    lib.fetchNotificationsResult.mockResolvedValue({ ok: true, items: [o1] });
    fireEvent.press(clearAll);
    await waitFor(() => expect(lastSnack().message).toBe("Cleared 500, but couldn't clear the rest."));
    expect(lastSnack().actionLabel).toBe('Undo');
    expect(await v.findByTestId('notification-row-o1')).toBeTruthy();
    expect(v.queryByTestId('notification-row-n1')).toBeNull();
    expect(v.queryByTestId('notification-row-n2')).toBeNull();
    lib.fetchNotificationsResult.mockResolvedValue({ ok: true, items: [n1, n2, o1] });
    await act(async () => { lastSnack().onAction?.(); });
    expect(lib.restoreNotifications).toHaveBeenCalledWith(landed.map((c) => c.id), ['n1']);
    expect(v.getByTestId('notification-row-n1')).toBeTruthy();
    expect(v.getByTestId('notification-row-n2')).toBeTruthy();
  });

  it('a Clear all that stopped at its 20,000 cap says so, keeps Undo, and re-reads for the rest', async () => {
    const landed = [...LANDED_ON_SCREEN, ...bulk(19_998)];
    lib.clearNotificationsUpTo.mockResolvedValueOnce({ ok: true, cleared: landed, more: true });
    const v = render(<NotificationsScreen />);
    const clearAll = await v.findByTestId('notifications-clear-all');
    lib.fetchNotificationsResult.mockResolvedValue({ ok: true, items: [o1] });
    fireEvent.press(clearAll);
    await waitFor(() => expect(lastSnack().message).toBe('Cleared 20,000. Tap Clear all again for the rest.'));
    expect(lastSnack().actionLabel).toBe('Undo');
    expect(await v.findByTestId('notification-row-o1')).toBeTruthy();
    expect(v.getByTestId('notifications-clear-all')).toBeTruthy();
  });

  it('an Undo all that fails part-way keeps what came back and offers Retry for just the rest', async () => {
    const landed = [...LANDED_ON_SCREEN, ...bulk(998)];
    const ids = landed.map((c) => c.id);
    lib.clearNotificationsUpTo.mockResolvedValueOnce({ ok: true, cleared: landed, more: false });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notifications-clear-all'));
    await waitFor(() => expect(lastSnack().message).toBe('Cleared all'));
    // The first 500 (n1 and n2 among them) came back, the second call failed.
    lib.restoreNotifications.mockResolvedValueOnce({ ok: false, restored: 500, unrestored: ids.slice(500) });
    lib.fetchNotificationsResult.mockResolvedValue({ ok: true, items: [n1, n2] });
    await act(async () => { lastSnack().onAction?.(); });
    expect(lastSnack().message).toBe("Couldn't undo all of them. The rest are still in Archived.");
    expect(lastSnack().actionLabel).toBe('Retry');
    expect(v.getByTestId('notification-row-n1')).toBeTruthy();
    expect(v.getByTestId('notification-row-n2')).toBeTruthy();
    await act(async () => { lastSnack().onAction?.(); });
    expect(lib.restoreNotifications).toHaveBeenLastCalledWith(ids.slice(500), []);
    expect(v.getByTestId('notification-row-n1')).toBeTruthy();
  });

  it('a failed Clear all puts every row back, with Retry', async () => {
    lib.clearNotificationsUpTo.mockResolvedValueOnce({ ok: false, cleared: [] });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notifications-clear-all'));
    await waitFor(() => expect(v.getByTestId('notification-row-n1')).toBeTruthy());
    expect(v.getByTestId('notification-row-n2')).toBeTruthy();
    expect(lastSnack().message).not.toBe('Cleared all');
    expect(lastSnack().actionLabel).toBe('Retry');
  });

  it('Clear all when nothing is left on the server is a success: rows leave, no Retry, no Undo', async () => {
    lib.clearNotificationsUpTo.mockResolvedValueOnce({ ok: true, cleared: [], more: false });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notifications-clear-all'));
    await waitFor(() => expect(lastSnack().message).toBe('Nothing left to clear'));
    expect(lastSnack().actionLabel).toBeUndefined();
    expect(v.queryByTestId('notification-row-n1')).toBeNull();
    expect(v.queryByTestId('notification-row-n2')).toBeNull();
  });

  it('Undo all that restores fewer than it cleared says so, re-reads, and never offers Retry', async () => {
    lib.restoreNotifications.mockResolvedValueOnce({ ok: true, restored: 1 });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notifications-clear-all'));
    await waitFor(() => expect(lastSnack().message).toBe('Cleared all'));
    // n1 was deleted while it sat in the archive: the server has only n2 now.
    lib.fetchNotificationsResult.mockResolvedValue({ ok: true, items: [n2] });
    await act(async () => { lastSnack().onAction?.(); });
    expect(lastSnack().message).toBe('Some notifications are no longer available');
    expect(lastSnack().actionLabel).toBeUndefined();
    await waitFor(() => expect(v.queryByTestId('notification-row-n1')).toBeNull());
    expect(v.getByTestId('notification-row-n2')).toBeTruthy();
    expect(lib.fetchNotificationsResult).toHaveBeenCalledTimes(2);
  });

  it('a reload that lands while a clear is in flight does not put the cleared row back', async () => {
    const write = deferred<ClearResult>();
    lib.clearNotifications.mockReturnValueOnce(write.promise);
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-clear-n1'));
    // The server has not committed the archive yet, and something new arrived.
    lib.fetchNotificationsResult.mockResolvedValue({ ok: true, items: [n1, n3, n2] });
    await pull(v);
    await v.findByTestId('notification-row-n3');
    expect(v.queryByTestId('notification-row-n1')).toBeNull();
    await act(async () => { write.resolve({ ok: true, cleared: [{ id: 'n1', wasUnread: true }] }); });
    expect(v.queryByTestId('notification-row-n1')).toBeNull();
  });

  it('a reload that lands while an Undo is in flight does not take the restored row away', async () => {
    const undo = deferred<RestoreResult>();
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-clear-n1'));
    await waitFor(() => expect(show).toHaveBeenCalled());
    lib.restoreNotifications.mockReturnValueOnce(undo.promise);
    await act(async () => { lastSnack().onAction?.(); });
    expect(v.getByTestId('notification-row-n1')).toBeTruthy();
    // The server has not committed the restore yet: n1 is still archived there.
    lib.fetchNotificationsResult.mockResolvedValue({ ok: true, items: [n3, n2] });
    await pull(v);
    await v.findByTestId('notification-row-n3');
    expect(v.getByTestId('notification-row-n1')).toBeTruthy();
    await act(async () => { undo.resolve({ ok: true, restored: 1 }); });
    expect(v.getByTestId('notification-row-n1')).toBeTruthy();
  });

  it('a single clear in flight when Clear all is tapped stays out of Clear all\'s Undo', async () => {
    const single = deferred<ClearResult>();
    lib.clearNotifications.mockReturnValueOnce(single.promise);
    const v = render(<NotificationsScreen />);
    // She clears n2 (older), then taps Clear all before that write lands; the
    // server's Clear all reaches n2 first and reports it.
    fireEvent.press(await v.findByTestId('notification-clear-n2'));
    fireEvent.press(v.getByTestId('notifications-clear-all'));
    expect(lib.clearNotificationsUpTo).toHaveBeenCalledWith(n1.created_at);
    await waitFor(() => expect(lastSnack().message).toBe('Cleared all'));
    await act(async () => { lastSnack().onAction?.(); });
    expect(lib.restoreNotifications).toHaveBeenCalledWith(['n1'], ['n1']);
    expect(v.getByTestId('notification-row-n1')).toBeTruthy();
    expect(v.queryByTestId('notification-row-n2')).toBeNull();
    // Its own write then finds nothing left to archive: quiet.
    const before = show.mock.calls.length;
    await act(async () => { single.resolve({ ok: true, cleared: [] }); });
    expect(show.mock.calls.length).toBe(before);
    expect(v.queryByTestId('notification-row-n2')).toBeNull();
  });

  it('no Clear all on an empty inbox; the empty state links to the archive', async () => {
    lib.fetchNotificationsResult.mockResolvedValue({ ok: true, items: [] });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notifications-view-archived'));
    expect(v.queryByTestId('notifications-clear-all')).toBeNull();
    expect(mockPush).toHaveBeenCalledWith('/notifications?view=archived');
  });

  it('"View archived" sits at the foot of a non-empty list', async () => {
    const v = render(<NotificationsScreen />);
    await v.findByTestId('notification-row-n1');
    fireEvent.press(v.getByTestId('notifications-view-archived'));
    expect(mockPush).toHaveBeenCalledWith('/notifications?view=archived');
  });

  it('a failed load is an error state with Retry, not an empty inbox', async () => {
    lib.fetchNotificationsResult.mockResolvedValueOnce({ ok: false });
    const v = render(<NotificationsScreen />);
    const retry = await v.findByTestId('notifications-retry');
    expect(v.queryByText('Nothing yet')).toBeNull();
    expect(v.queryByTestId('notifications-clear-all')).toBeNull();
    fireEvent.press(retry);
    expect(await v.findByTestId('notification-row-n1')).toBeTruthy();
    expect(lib.fetchNotificationsResult).toHaveBeenCalledTimes(2);
  });
});

describe('archived view (?view=archived)', () => {
  beforeEach(() => { mockParams.view = 'archived'; });

  it('reads the archive, titles it "Archived", has Restore and no clear controls', async () => {
    const v = render(<NotificationsScreen />);
    await v.findByTestId('notification-row-a1');
    expect(v.getByText('Archived')).toBeTruthy();
    expect(lib.fetchArchivedNotifications).toHaveBeenCalledWith('u1');
    expect(lib.fetchNotificationsResult).not.toHaveBeenCalled();
    expect(v.queryByTestId('notification-clear-a1')).toBeNull();
    expect(v.queryByTestId('notifications-clear-all')).toBeNull();
    expect(v.queryByText('Mark all read')).toBeNull();
    expect(v.queryByTestId('notifications-view-archived')).toBeNull();
    expect(v.getByTestId('notification-restore-a1')).toBeTruthy();
  });

  it('a row still opens', async () => {
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-row-a1'));
    expect(mockPush).toHaveBeenCalledWith('/post/p2');
  });

  it('Restore takes the row out of the archive, back in read', async () => {
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-restore-a1'));
    expect(v.queryByTestId('notification-row-a1')).toBeNull();
    expect(lib.restoreNotifications).toHaveBeenCalledWith(['a1'], []);
    await waitFor(() => expect(lastSnack().message).toBe('Restored'));
  });

  it('a failed Restore puts the row back and says so with Retry', async () => {
    lib.restoreNotifications.mockResolvedValueOnce({ ok: false });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-restore-a1'));
    await waitFor(() => expect(v.getByTestId('notification-row-a1')).toBeTruthy());
    expect(lastSnack().message).not.toBe('Restored');
    expect(lastSnack().actionLabel).toBe('Retry');
  });

  it('Restore of a row deleted meanwhile: it leaves the list and says so, no Retry', async () => {
    lib.restoreNotifications.mockResolvedValueOnce({ ok: true, restored: 0 });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-restore-a1'));
    await waitFor(() => expect(lastSnack().message).toBe('That notification is no longer available'));
    expect(lastSnack().actionLabel).toBeUndefined();
    expect(v.queryByTestId('notification-row-a1')).toBeNull();
  });

  it('a reload that lands while a Restore is in flight does not put the row back', async () => {
    const write = deferred<RestoreResult>();
    lib.restoreNotifications.mockReturnValueOnce(write.promise);
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notification-restore-a1'));
    lib.fetchArchivedNotifications.mockResolvedValue({ ok: true, items: [a1, a2] });
    await pull(v);
    await v.findByTestId('notification-row-a2');
    expect(v.queryByTestId('notification-row-a1')).toBeNull();
    await act(async () => { write.resolve({ ok: true, restored: 1 }); });
    expect(v.queryByTestId('notification-row-a1')).toBeNull();
  });

  it('an empty archive says so', async () => {
    lib.fetchArchivedNotifications.mockResolvedValueOnce({ ok: true, items: [] });
    const v = render(<NotificationsScreen />);
    expect(await v.findByText('Nothing archived')).toBeTruthy();
  });

  it('a failed archive load is an error state with Retry', async () => {
    lib.fetchArchivedNotifications.mockResolvedValueOnce({ ok: false });
    const v = render(<NotificationsScreen />);
    fireEvent.press(await v.findByTestId('notifications-retry'));
    expect(await v.findByTestId('notification-row-a1')).toBeTruthy();
  });
});
