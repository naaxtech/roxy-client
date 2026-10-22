/**
 * Lane B's request, applied at the Wave 3 merge (decision P2): her cache-first
 * copies on disk (Feed page 1, Discover rails, her own profile; lib/cacheFirst)
 * are hers alone and never outlive her session. Signing out, or a session that
 * ends, clears the PREVIOUS member's copies; a token refresh for the same
 * member keeps them.
 */
import { act } from '@testing-library/react-native';

const mockClearCache = jest.fn((_userId: string) => Promise.resolve());
jest.mock('../../lib/cacheFirst', () => ({
  clearCache: (userId: string) => mockClearCache(userId),
}));

import { useAuthStore } from '../../store/authStore';

const signedIn = (id: string) => ({ user: { id }, access_token: 't' }) as never;

beforeEach(() => {
  mockClearCache.mockReset();
  mockClearCache.mockImplementation(() => Promise.resolve());
  useAuthStore.setState({ user: null, session: null, loading: true });
});

describe('authStore clears her cache-first copies when her session ends (P2)', () => {
  it('signing out clears the signed-out member\'s copies', () => {
    act(() => { useAuthStore.getState().setSession(signedIn('u1')); });
    act(() => { useAuthStore.getState().signOut(); });
    expect(mockClearCache).toHaveBeenCalledTimes(1);
    expect(mockClearCache).toHaveBeenCalledWith('u1');
  });

  it('a session that ends (setSession(null)) clears them too', () => {
    act(() => { useAuthStore.getState().setSession(signedIn('u2')); });
    act(() => { useAuthStore.getState().setSession(null); });
    expect(mockClearCache).toHaveBeenCalledWith('u2');
  });

  it('a token refresh for the same member keeps them', () => {
    act(() => { useAuthStore.getState().setSession(signedIn('u1')); });
    act(() => { useAuthStore.getState().setSession(signedIn('u1')); });
    expect(mockClearCache).not.toHaveBeenCalled();
  });

  it('another member signing in on the same phone clears the previous member\'s copies', () => {
    act(() => { useAuthStore.getState().setSession(signedIn('u1')); });
    act(() => { useAuthStore.getState().setSession(signedIn('u4')); });
    expect(mockClearCache.mock.calls).toEqual([['u1']]);
  });

  it('no one signed in: nothing to clear, and a storage failure never breaks sign-out', () => {
    act(() => { useAuthStore.getState().signOut(); });
    expect(mockClearCache).not.toHaveBeenCalled();
    mockClearCache.mockImplementation(() => Promise.reject(new Error('storage')));
    act(() => { useAuthStore.getState().setSession(signedIn('u3')); });
    expect(() => act(() => { useAuthStore.getState().signOut(); })).not.toThrow();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
