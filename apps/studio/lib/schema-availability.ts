import type { PostgrestError } from '@supabase/supabase-js';

/**
 * "This migration has not been applied to this project yet" vs "something broke".
 *
 * The studio ships ahead of the database on purpose: a page whose migration is
 * still in review must render an honest "not available yet" state, never a
 * crash and never a lie about there being no data. These two helpers are the
 * only thing standing between those two outcomes, so they match on the codes
 * PostgREST actually returns rather than on message text, which is not stable.
 *
 * PGRST205 / PGRST202 come from the schema cache (the table or function is not
 * in it); 42P01 / 42883 are the raw Postgres SQLSTATEs for the same conditions,
 * returned when the request reaches the database before the cache is reloaded.
 * Both pairs mean the same thing to a caller, so both are handled.
 *
 * // src: https://supabase.com/docs/guides/api/rest/postgrest-error-codes · PostgREST (Supabase Data API) · 2026-08-02
 */
const MISSING_TABLE_CODES: readonly string[] = ['PGRST205', '42P01'];
const MISSING_FUNCTION_CODES: readonly string[] = ['PGRST202', '42883'];

/** True when the failure is "that table does not exist here yet". */
export function isMissingTable(error: PostgrestError | null | undefined): boolean {
  return error != null && MISSING_TABLE_CODES.includes(error.code);
}

/** True when the failure is "that function does not exist here yet". */
export function isMissingFunction(error: PostgrestError | null | undefined): boolean {
  return error != null && MISSING_FUNCTION_CODES.includes(error.code);
}
