import { act, renderHook } from '@testing-library/react-native';
import { useAuthStore } from '../../store/authStore';
import { readThreadPage, writeThreadPage } from '../../components/chat/threadCache';
import { readChannelPage, writeChannelPage } from '../../components/channels/channelCache';
import { readEventMemory, writeEventMemory } from '../../components/events/eventCache';

describe('in-session memory ends with the session (P2: never kept past her)', () => {
  const remember = () => {
    writeThreadPage('u1', 'c1', [{ id: 'm1' } as never]);
    writeChannelPage('u1', 'ch1', [{ id: 'cm1' } as never]);
    writeEventMemory('u1', 'e1', { event: { id: 'e1' }, ticketCode: null });
  };
  const forgotten = () => {
    expect(readThreadPage('u1', 'c1')).toBeNull();
    expect(readChannelPage('u1', 'ch1')).toBeNull();
    expect(readEventMemory('u1', 'e1')).toBeNull();
  };

  it('signing out forgets her DM, channel and event memory', () => {
    remember();
    expect(readThreadPage('u1', 'c1')).not.toBeNull();
    act(() => { useAuthStore.getState().signOut(); });
    forgotten();
  });

  it('a session that ends (setSession(null)) forgets it too', () => {
    remember();
    act(() => { useAuthStore.getState().setSession(null); });
    forgotten();
  });

  it('a token refresh for the same member keeps it', () => {
    remember();
    act(() => { useAuthStore.getState().setSession({ user: { id: 'u1' } } as never); });
    expect(readThreadPage('u1', 'c1')).not.toBeNull();
  });
});

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
