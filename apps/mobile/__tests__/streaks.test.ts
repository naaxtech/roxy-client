import { recordDailyCheckin } from '../lib/streaks';

jest.mock('../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));
const { supabase } = jest.requireMock('../lib/supabase');

describe('recordDailyCheckin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the streak count on success, passing the device timezone', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 5, error: null });
    await expect(recordDailyCheckin()).resolves.toBe(5);
    expect(supabase.rpc).toHaveBeenCalledWith('record_daily_checkin', {
      client_tz: expect.any(String),
    });
  });

  it('returns null when the RPC errors (e.g. migration not applied yet)', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'missing' } });
    await expect(recordDailyCheckin()).resolves.toBeNull();
  });

  it('returns null when the RPC throws', async () => {
    (supabase.rpc as jest.Mock).mockRejectedValue(new Error('network'));
    await expect(recordDailyCheckin()).resolves.toBeNull();
  });

  it('returns null for a non-numeric payload', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 'weird', error: null });
    await expect(recordDailyCheckin()).resolves.toBeNull();
  });
});
