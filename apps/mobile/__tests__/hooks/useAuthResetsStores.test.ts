/**
 * ARC-08 end to end through useAuth: signing out (by tapping Sign out, or by
 * the session ending elsewhere, or by another account opening) leaves none of
 * her Archive, feed, follow or safety state for the next person on the phone.
 */
jest.mock('react-native-url-polyfill/auto', () => {});
jest.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('../../lib/pushRegistration', () => ({ unregisterDevice: jest.fn().mockResolvedValue(undefined) }));

type AuthCb = (event: string, session: unknown) => void;
let mockAuthCb: AuthCb | null = null;

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn((cb: AuthCb) => {
        mockAuthCb = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      signOut: jest.fn(() => Promise.resolve({ error: null })),
    },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { renderHook, act } from '@testing-library/react-native';
import { useAuth } from '../../hooks/useAuth';
import { useArchiveStore } from '../../store/archiveStore';
import { useAuthStore } from '../../store/authStore';
import { useFeedStore } from '../../store/feedStore';
import { useFollowStore } from '../../store/followStore';
import { useGateStore } from '../../store/gateStore';

function seedHerData() {
  useArchiveStore.setState({ myVotes: { e1: 5 }, watchlist: ['e2'] });
  useFeedStore.setState({ likedPostIds: new Set(['p1']) });
  useFollowStore.setState({ followingIds: new Set(['u2']), hydrated: true });
}

function expectNothingOfHers() {
  expect(useArchiveStore.getState().myVotes).toEqual({});
  expect(useArchiveStore.getState().watchlist).toEqual([]);
  expect([...useFeedStore.getState().likedPostIds]).toEqual([]);
  expect([...useFollowStore.getState().followingIds]).toEqual([]);
}

const session = (id: string) => ({ user: { id, email: `${id}@x.test` }, access_token: 't' });

describe('sign-out resets every per-user store', () => {
  beforeEach(() => {
    mockAuthCb = null;
  });

  it('tapping Sign out wipes her Archive votes, likes and follows', async () => {
    seedHerData();
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signOut();
    });
    expectNothingOfHers();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('a session that ends elsewhere (SIGNED_OUT) wipes them too', async () => {
    renderHook(() => useAuth());
    act(() => mockAuthCb!('SIGNED_IN', session('a')));
    seedHerData();
    act(() => mockAuthCb!('SIGNED_OUT', null));
    expectNothingOfHers();
  });

  it('another account opening on the phone wipes the first one\'s data', async () => {
    renderHook(() => useAuth());
    act(() => mockAuthCb!('SIGNED_IN', session('a')));
    seedHerData();
    act(() => mockAuthCb!('SIGNED_IN', session('b')));
    expectNothingOfHers();
    expect(useAuthStore.getState().user?.id).toBe('b');
  });

  it('a token refresh for the same woman keeps her data', async () => {
    renderHook(() => useAuth());
    act(() => mockAuthCb!('SIGNED_IN', session('a')));
    seedHerData();
    act(() => mockAuthCb!('TOKEN_REFRESHED', session('a')));
    expect(useArchiveStore.getState().myVotes).toEqual({ e1: 5 });
  });

  it('the session-ended path keeps an invite code she is mid-way through', async () => {
    renderHook(() => useAuth());
    useGateStore.setState({ validatedCode: 'ROXY-1234' });
    act(() => mockAuthCb!('SIGNED_OUT', null));
    expect(useGateStore.getState().validatedCode).toBe('ROXY-1234');
  });
});
