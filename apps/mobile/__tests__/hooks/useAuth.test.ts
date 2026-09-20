jest.mock('react-native-url-polyfill/auto', () => {});
jest.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const mockUnsubscribe = jest.fn();
const mockGetSession = jest.fn().mockResolvedValue({ data: { session: null } });
const mockOnAuthStateChange = jest.fn().mockReturnValue({
  data: { subscription: { unsubscribe: mockUnsubscribe } },
});
const mockSignUp = jest.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockSignInWithPassword = jest.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockResetPasswordForEmail = jest.fn().mockResolvedValue({ error: null });
const mockSignOut = jest.fn().mockResolvedValue({ error: null });
const mockSignInWithOAuth = jest.fn().mockResolvedValue({ error: null });

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signUp: mockSignUp,
      signInWithPassword: mockSignInWithPassword,
      resetPasswordForEmail: mockResetPasswordForEmail,
      signOut: mockSignOut,
      signInWithOAuth: mockSignInWithOAuth,
    },
    functions: { invoke: jest.fn() },
  })),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

import { renderHook, act } from '@testing-library/react-native';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useAuth } = require('../../hooks/useAuth') as typeof import('../../hooks/useAuth');

describe('useAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    });
  });

  it('exposes signUp, signInWithPassword, resetPassword, signOut, OAuth methods', () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.signUp).toBe('function');
    expect(typeof result.current.signInWithPassword).toBe('function');
    expect(typeof result.current.resetPassword).toBe('function');
    expect(typeof result.current.signOut).toBe('function');
    expect(typeof result.current.signInWithApple).toBe('function');
    expect(typeof result.current.signInWithGoogle).toBe('function');
  });

  it('calls getSession on mount', async () => {
    renderHook(() => useAuth());
    await act(async () => {});
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from auth changes on unmount', async () => {
    const { unmount } = renderHook(() => useAuth());
    await act(async () => {});
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('signUp calls supabase.auth.signUp with email and password', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: {
        user: { identities: [{ id: 'i1' }] },
        session: { user: { email: 'test@example.com' } },
      },
      error: null,
    });
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signUp('test@example.com', 'password123');
    });
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
    });
  });

  it('refuses a leftover session that is not the email she typed', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: {
        user: { identities: [{ id: 'i1' }] },
        session: { user: { email: 'naaxtech.official@gmail.com' } },
      },
      error: null,
    });
    const { result } = renderHook(() => useAuth());
    let response: { error: { message: string } | null };
    await act(async () => {
      response = await result.current.signUp('thepurrfessionals@gmail.com', 'password123');
    });
    expect(response!.error?.message).toMatch(/did not open the new account/i);
  });

  it('signInWithPassword calls supabase.auth.signInWithPassword', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signInWithPassword('test@example.com', 'password123');
    });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
    });
  });

  it('resetPassword calls supabase.auth.resetPasswordForEmail', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.resetPassword('test@example.com');
    });
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('test@example.com');
  });

  it('signUp returns error on failure', async () => {
    const authError = { message: 'User already registered' };
    mockSignUp.mockResolvedValueOnce({ data: { session: null }, error: authError });
    const { result } = renderHook(() => useAuth());
    let response: { error: typeof authError | null };
    await act(async () => {
      response = await result.current.signUp('test@example.com', 'password123');
    });
    expect(response!.error).toEqual(authError);
  });
});
