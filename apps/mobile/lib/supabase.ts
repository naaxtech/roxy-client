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
): Promise<{ data: T | null; error: string | null }> => {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) return { data: null, error: error.message };
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
