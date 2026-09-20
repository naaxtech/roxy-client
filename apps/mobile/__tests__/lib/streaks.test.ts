import { recordDailyCheckin } from '../../lib/streaks';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';

jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

const rpc = supabase.rpc as unknown as jest.Mock;
const logged = logError as jest.MockedFunction<typeof logError>;

beforeEach(() => {
  rpc.mockReset();
  logged.mockReset();
});

/**
 * The contract `StreakChip` leans on: this never rejects, and it is never
 * silent about why it gave up.
 *
 * Returning `null` on failure is deliberate — the chip hides rather than
 * claiming a zero-day streak. But `null` was reached from four different causes
 * with no record of any of them, so a woman seeing her streak vanish and an
 * engineer looking for the reason had exactly the same information: none. The
 * auth race that this file's sibling test covers was found in a browser, not in
 * a log, precisely because there was no log.
 */
describe('recordDailyCheckin', () => {
  it('returns the streak the server computed', async () => {
    rpc.mockResolvedValue({ data: 7, error: null });
    await expect(recordDailyCheckin()).resolves.toBe(7);
    expect(logged).not.toHaveBeenCalled();
  });

  it('sends the device timezone so "a day" is her local day', async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    await recordDailyCheckin();

    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('record_daily_checkin');
    expect(typeof (args as { client_tz: string }).client_tz).toBe('string');
    expect((args as { client_tz: string }).client_tz.length).toBeGreaterThan(0);
  });

  it('hides the streak AND logs when the RPC refuses', async () => {
    // The real one seen in the browser: `P0001 not authenticated`.
    rpc.mockResolvedValue({ data: null, error: { message: 'not authenticated', code: 'P0001' } });

    await expect(recordDailyCheckin()).resolves.toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][1]).toBe('recordDailyCheckin');
  });

  it('hides the streak AND logs when the RPC answers something that is not a number', async () => {
    rpc.mockResolvedValue({ data: 'seven', error: null });

    await expect(recordDailyCheckin()).resolves.toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('never rejects, whatever the client throws', async () => {
    // This is what lets `StreakChip` call it without a `.catch` — a promise
    // that cannot reject makes one dead code.
    rpc.mockRejectedValue(new Error('network down'));

    await expect(recordDailyCheckin()).resolves.toBeNull();
    expect(logged).toHaveBeenCalledWith(expect.any(Error), 'recordDailyCheckin.threw');
  });
});
