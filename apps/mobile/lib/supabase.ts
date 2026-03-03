import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

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
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
};
