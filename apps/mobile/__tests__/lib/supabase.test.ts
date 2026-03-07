jest.mock('react-native-url-polyfill/auto', () => {});
jest.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(),
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
    functions: {
      invoke: jest.fn(),
    },
  })),
}));

// Set required env vars before importing the module
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// Use require so the module is loaded after env vars are set (import is hoisted)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { supabase, callEdgeFunction } = require('../../lib/supabase') as typeof import('../../lib/supabase');

describe('supabase client', () => {
  it('exports a supabase client instance with expected shape', () => {
    expect(supabase).toBeDefined();
    expect(typeof supabase.from).toBe('function');
    expect(typeof supabase.auth.getSession).toBe('function');
  });

  it('callEdgeFunction returns data on success', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { greeting: 'Hello!' },
      error: null,
    });

    const result = await callEdgeFunction<{ greeting: string }>('roxy-greeting', {});
    expect(result.data?.greeting).toBe('Hello!');
    expect(result.error).toBeNull();
  });

  it('callEdgeFunction returns error string on invoke error', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'Unauthorized' },
    });

    const result = await callEdgeFunction('roxy-greeting', {});
    expect(result.data).toBeNull();
    expect(result.error).toBe('Unauthorized');
  });

  it('callEdgeFunction returns error string when invoke throws (network failure)', async () => {
    (supabase.functions.invoke as jest.Mock).mockRejectedValueOnce(
      new Error('Network request failed')
    );

    const result = await callEdgeFunction('roxy-greeting', {});
    expect(result.data).toBeNull();
    expect(result.error).toBe('Network request failed');
  });
});
