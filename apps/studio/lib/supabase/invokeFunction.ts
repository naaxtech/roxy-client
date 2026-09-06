import type { SupabaseClient } from '@supabase/supabase-js';

export interface InvokeResult<T> {
  data: T | null;
  error: string | null;
  status?: number;
}

/**
 * Call a Supabase edge function and get the REAL failure back.
 *
 * supabase-js rejects any non-2xx response with a FunctionsHttpError whose
 * `.message` is the useless literal "Edge Function returned a non-2xx status
 * code". The `{ success:false, error }` body our functions actually send (see
 * supabase/functions/_shared/errorHandler.ts) and the HTTP status only exist on
 * `error.context`, the raw Response.
 *
 * Callers that destructure `const { data } = await supabase.functions.invoke(…)`
 * therefore cannot tell "room is full" from "you are not a member" from
 * "DAILY_API_KEY is unset", and every one of them collapsed into a single
 * "Please try again" — which is wrong advice for most of those cases.
 */
export async function invokeFunction<T = unknown>(
  supabase: SupabaseClient,
  name: string,
  body: Record<string, unknown>,
): Promise<InvokeResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });

    if (error) {
      let parsedBody: { error?: string } | undefined;
      try {
        parsedBody = await (error as { context?: Response }).context?.json?.();
      } catch {
        parsedBody = undefined;
      }
      return {
        data: null,
        error: parsedBody?.error ?? error.message ?? 'Request failed',
        status: (error as { context?: Response }).context?.status,
      };
    }

    // Unwrap the { success, data, error } envelope from successResponse/errorResponse.
    if (data && typeof data === 'object' && 'success' in data) {
      const envelope = data as { success: boolean; data: T; error: string | null };
      if (!envelope.success) return { data: null, error: envelope.error ?? 'Request failed' };
      return { data: envelope.data, error: null };
    }

    return { data: data as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
