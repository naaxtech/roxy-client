import { act, renderHook } from '@testing-library/react-native';
import { useAuthStore } from '../../store/authStore';

describe('authStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useAuthStore.setState({ user: null, session: null, loading: true });
  });

  it('initialises with null user, null session, loading true', () => {
    const { result } = renderHook(() => useAuthStore());
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('setSession with a session sets user and clears loading', () => {
    const { result } = renderHook(() => useAuthStore());
    const mockSession = {
      user: { id: 'user-1', email: 'test@test.com' },
      access_token: 'tok',
    } as any;

    act(() => result.current.setSession(mockSession));

    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.session).toBe(mockSession);
    expect(result.current.loading).toBe(false);
  });

  it('setSession with null clears user and session', () => {
    const { result } = renderHook(() => useAuthStore());
    act(() => result.current.setSession(null));
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('signOut clears user and session', () => {
    const { result } = renderHook(() => useAuthStore());
    const mockSession = { user: { id: 'u1' }, access_token: 't' } as any;
    act(() => result.current.setSession(mockSession));
    act(() => result.current.signOut());
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
  });
});
