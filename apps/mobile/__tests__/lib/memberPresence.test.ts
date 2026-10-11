jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { fetchOnlineIds, presenceStamp } from '../../lib/memberPresence';
import { isOnline } from '../../store/friendStore';

const { supabase } = jest.requireMock('../../lib/supabase') as { supabase: { rpc: jest.Mock } };
const { logError } = jest.requireMock('../../lib/errorLogger') as { logError: jest.Mock };

beforeEach(() => jest.clearAllMocks());

/**
 * 130 / PRO-01: another member's last_seen_at is no longer readable. "Online
 * now" comes from member_presence(), which answers yes/no and never a time.
 */
describe('fetchOnlineIds', () => {
  it('asks member_presence once, de-duplicated, and keeps only the online ids', async () => {
    supabase.rpc.mockResolvedValue({
      data: [{ user_id: 'a', online: true }, { user_id: 'b', online: false }],
      error: null,
    });

    const online = await fetchOnlineIds(['a', 'b', 'a', '']);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('member_presence', { p_user_ids: ['a', 'b'] });
    expect([...online]).toEqual(['a']);
  });

  it('makes no request for an empty list', async () => {
    const online = await fetchOnlineIds([]);
    expect(online.size).toBe(0);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('never fails the screen: an RPC error is logged and reads as nobody online', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const online = await fetchOnlineIds(['a']);
    expect(online.size).toBe(0);
    expect(logError).toHaveBeenCalled();
  });

  it('survives a thrown transport error the same way', async () => {
    supabase.rpc.mockRejectedValue(new Error('offline'));
    await expect(fetchOnlineIds(['a'])).resolves.toEqual(new Set());
  });
});

describe('presenceStamp', () => {
  it('reads as online for an online member and offline otherwise', () => {
    expect(isOnline(presenceStamp(true))).toBe(true);
    expect(isOnline(presenceStamp(false))).toBe(false);
  });
});
