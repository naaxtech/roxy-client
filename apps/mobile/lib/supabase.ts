import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing required env vars: EXPO_PUBLIC_SUPABASE_URL and/or EXPO_PUBLIC_SUPABASE_ANON_KEY'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const callEdgeFunction = async <T>(
  name: string,
  body: Record<string, unknown>
): Promise<{ data: T | null; error: string | null; status?: number }> => {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      // supabase-js rejects any non-2xx response with a FunctionsHttpError whose
      // .message is the useless literal "Edge Function returned a non-2xx status
      // code" — the real { success:false, error } body our edge functions send
      // (see supabase/functions/_shared/errorHandler.ts) only lives on
      // error.context (the raw Response), same for the HTTP status.
      let parsedBody: { error?: string } | undefined;
      try {
        parsedBody = await (error as { context?: Response }).context?.json?.();
      } catch {
        parsedBody = undefined;
      }
      return {
        data: null,
        error: parsedBody?.error ?? error.message,
        status: (error as { context?: Response }).context?.status,
      };
    }
    // Unwrap { success, data, error } envelope used by successResponse/errorResponse
    if (data && typeof data === 'object' && 'success' in data) {
      if (!data.success) return { data: null, error: (data as any).error ?? 'Request failed' };
      return { data: (data as any).data as T, error: null };
    }
    return { data: data as T, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { data: null, error: message };
  }
};
