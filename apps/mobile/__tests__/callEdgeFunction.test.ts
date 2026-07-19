export {};

// callEdgeFunction is defined in lib/supabase.ts and builds its own client
// internally via createClient() from '@supabase/supabase-js' — there is no
// separately-exported client to intercept, so we mock createClient itself
// (same pattern as __tests__/lib/supabase.test.ts) and drive
// supabase.functions.invoke off the object it returns.
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
const { supabase, callEdgeFunction } = require('../lib/supabase') as typeof import('../lib/supabase');

describe('callEdgeFunction — real edge-function error threading', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('passes success data straight through with no status', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: { room_url: 'https://roxy.daily.co/some-room' },
      error: null,
    });

    const result = await callEdgeFunction<{ room_url: string }>('join-community-room', {
      room_id: 'abc',
    });

    expect(result.data?.room_url).toBe('https://roxy.daily.co/some-room');
    expect(result.error).toBeNull();
    expect(result.status).toBeUndefined();
  });

  it('reads the real { success:false, error } body and status off error.context.json()', async () => {
    const mockContext = {
      status: 410,
      json: jest.fn().mockResolvedValue({ success: false, data: null, error: 'Room is closed' }),
    };
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: mockContext,
      },
    });

    const result = await callEdgeFunction('join-community-room', { room_id: 'abc' });

    expect(result.data).toBeNull();
    expect(result.error).toBe('Room is closed');
    expect(result.status).toBe(410);
    expect(mockContext.json).toHaveBeenCalledTimes(1);
  });

  it('falls back to error.message when context.json() rejects', async () => {
    const mockContext = {
      status: 500,
      json: jest.fn().mockRejectedValue(new Error('body is not valid JSON')),
    };
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: mockContext,
      },
    });

    const result = await callEdgeFunction('join-community-room', { room_id: 'abc' });

    expect(result.data).toBeNull();
    expect(result.error).toBe('Edge Function returned a non-2xx status code');
    expect(result.status).toBe(500);
  });
});
