// Jest globalSetup: runs in the main process before workers are spawned.
// Sets EXPO_PUBLIC_* env vars so babel-preset-expo can inline them correctly in tests.
module.exports = async () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL =
    process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key';
};
