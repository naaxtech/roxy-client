import {
  fetchNotifications, markNotificationRead, markAllNotificationsRead, countUnread,
  RoxyNotification,
} from '../lib/notifications';

jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));
const { supabase } = jest.requireMock('../lib/supabase');

const row = (over: Partial<RoxyNotification> = {}): RoxyNotification => ({
  id: 'n1', type: 'friend_request', title: 't', body: null, link_path: null,
  created_at: '2026-07-18T00:00:00Z', read_at: null, ...over,
});

describe('fetchNotifications', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns rows on success', async () => {
    const limit = jest.fn().mockResolvedValue({ data: [row()], error: null });
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ order: jest.fn(() => ({ limit })) })) })),
    });
    await expect(fetchNotifications('me')).resolves.toHaveLength(1);
  });

  it('returns [] on error (migration not applied yet)', async () => {
    const limit = jest.fn().mockResolvedValue({ data: null, error: { message: 'missing' } });
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ order: jest.fn(() => ({ limit })) })) })),
    });
    await expect(fetchNotifications('me')).resolves.toEqual([]);
  });
});

describe('mark read', () => {
  beforeEach(() => jest.clearAllMocks());

  it('markNotificationRead updates the row by id', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn(() => ({ eq }));
    (supabase.from as jest.Mock).mockReturnValue({ update });
    await markNotificationRead('n1');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ read_at: expect.any(String) }));
    expect(eq).toHaveBeenCalledWith('id', 'n1');
  });

  it('markAllNotificationsRead updates unread rows for the user', async () => {
    const is = jest.fn().mockResolvedValue({ error: null });
    const eq = jest.fn(() => ({ is }));
    const update = jest.fn(() => ({ eq }));
    (supabase.from as jest.Mock).mockReturnValue({ update });
    await markAllNotificationsRead('me');
    expect(eq).toHaveBeenCalledWith('user_id', 'me');
    expect(is).toHaveBeenCalledWith('read_at', null);
  });
});

describe('countUnread', () => {
  it('counts rows without read_at', () => {
    expect(countUnread([row(), row({ id: 'n2', read_at: '2026-07-18T01:00:00Z' })])).toBe(1);
  });
});
