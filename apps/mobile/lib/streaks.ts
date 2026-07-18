import { supabase } from './supabase';

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
    if (error || typeof data !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}
