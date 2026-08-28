import { supabase } from './supabase';
import { logError } from './errorLogger';

/**
 * Records today's check-in server-side and returns the current streak count.
 * Returns null on any failure so the streak chip simply hides — the Grow
 * screen must render fine on projects where migration 056 isn't applied yet.
 */
export async function recordDailyCheckin(): Promise<number | null> {
  try {
    // Device timezone so "a day" means the user's local day; the RPC falls
    // back to UTC when the value is missing or invalid.
    let clientTz = 'UTC';
    try {
      clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    } catch {
      // keep UTC
    }
    const { data, error } = await supabase.rpc('record_daily_checkin', { client_tz: clientTz });
    if (error) {
      // Returning null hides the chip, which is the right thing to show and the
      // wrong thing to say nothing about. Every cause lands here — migration 056
      // unapplied, an RLS change, a signature change, a dropped connection — and
      // without this line all of them look identical from the outside: a streak
      // that quietly stopped existing. The error object carries no PII.
      logError(error, 'recordDailyCheckin');
      return null;
    }
    if (typeof data !== 'number') {
      logError(new Error(`record_daily_checkin returned ${typeof data}`), 'recordDailyCheckin');
      return null;
    }
    return data;
  } catch (e) {
    logError(e, 'recordDailyCheckin.threw');
    return null;
  }
}
