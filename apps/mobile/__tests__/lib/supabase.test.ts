// Mock the external modules before importing the module under test
jest.mock('react-native-url-polyfill/auto', () => {});
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
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

import { supabase, callEdgeFunction } from '../../lib/supabase';

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

  it('callEdgeFunction returns error string on failure', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'Unauthorized' },
    });

    const result = await callEdgeFunction('roxy-greeting', {});
    expect(result.data).toBeNull();
    expect(result.error).toBe('Unauthorized');
  });
});
