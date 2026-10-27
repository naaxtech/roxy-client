/**
 * The root layout's redirect hook, rendered the way app/_layout.tsx renders it.
 *
 * Bug A is a timing bug, so it needs a timing test: expo-router throws
 * "Attempted to navigate before mounting the Root Layout component" from
 * router.replace when no navigator has mounted yet, and the root layout holds
 * its navigator back until the fonts load. The URL alone hands useSegments()
 * real segments in that window, so a guard on segments does not hold. The
 * only honest signal is the root navigation state's `key`, which exists only
 * once a navigator has mounted. The mock below reproduces both halves: a
 * URL-derived state with no key, then the mounted navigator's state.
 */
import { renderHook, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
let mockSegments: string[] = [];
let mockPathname = '/';
// What expo-router's store holds before any navigator mounts: the state it
// parsed from the URL (getStateFromPath), with no `key`.
const URL_STATE = { routes: [{ name: 'notifications' }] };
const MOUNTED_STATE = { key: 'stack-root', index: 0, routes: [{ key: 'notifications-1', name: 'notifications' }] };
let mockRootState: object | undefined = URL_STATE;
// Readiness comes from the container ref (useRootNavigatorReady); it is ready
// exactly when a navigator has mounted, i.e. when the root state has a key.
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSegments: () => mockSegments,
  usePathname: () => mockPathname,
  useNavigationContainerRef: () => ({ isReady: () => !!(mockRootState as { key?: string } | undefined)?.key }),
}));

type Row = { id: string; vetting_status: string | null; onboarding_completed: boolean; deleted_at: string | null } | null;
const mockFetch = jest.fn<Promise<{ data: Row; error: unknown }>, []>();
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => mockFetch() }) }) }),
  },
}));

const mockSetProfile = jest.fn();
const mockProfileState: { profile: { id: string; onboarding_completed?: boolean } | null; setProfile: jest.Mock } = {
  profile: null,
  setProfile: mockSetProfile,
};
jest.mock('../../store/profileStore', () => ({ useProfileStore: () => mockProfileState }));

const mockGate = { validatedCode: null as string | null };
jest.mock('../../store/gateStore', () => ({ useGateStore: { getState: () => mockGate } }));

jest.mock('../../store/viewAsStore', () => {
  const state = { preview: null };
  const useViewAsStore = (sel: (s: typeof state) => unknown) => sel(state);
  useViewAsStore.getState = () => state;
  return { useViewAsStore };
});

const mockThemeInit = jest.fn(() => Promise.resolve());
jest.mock('../../store/themeStore', () => ({ useThemeStore: { getState: () => ({ init: mockThemeInit }) } }));

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn(), logBreadcrumb: jest.fn() }));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn() }));

import { useRootRedirect } from '../../hooks/useRootRedirect';

const flush = () => new Promise((r) => setTimeout(r, 0));
const MEMBER: Row = { id: 'u1', vetting_status: 'approved', onboarding_completed: true, deleted_at: null };

type Auth = { user: { id: string } | null; loading: boolean; signOut: () => Promise<void> };
const signedOut: Auth = { user: null, loading: false, signOut: jest.fn(() => Promise.resolve()) };
const signedIn: Auth = { user: { id: 'u1' }, loading: false, signOut: jest.fn(() => Promise.resolve()) };

const at = (segments: string[], pathname: string) => {
  mockSegments = segments;
  mockPathname = pathname;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRootState = URL_STATE;
  at([], '/');
  mockProfileState.profile = null;
  mockGate.validatedCode = null;
  mockFetch.mockResolvedValue({ data: MEMBER, error: null });
});

describe('useRootRedirect — Bug A: a signed-out deep link', () => {
  it('does not navigate while the root navigator is not mounted, then sends her to the code gate', async () => {
    at(['notifications'], '/notifications');
    const { rerender } = renderHook((auth: Auth) => useRootRedirect(auth), { initialProps: signedOut });
    await flush();
    // The crash: this call used to happen here, before any navigator existed.
    expect(mockReplace).not.toHaveBeenCalled();

    mockRootState = MOUNTED_STATE;
    rerender(signedOut);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/code'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('a signed-in reload on a deep link checks nothing until the navigator is mounted', async () => {
    at(['notifications'], '/notifications');
    mockFetch.mockResolvedValue({ data: { ...MEMBER, onboarding_completed: false } as Row, error: null });
    const { rerender } = renderHook((auth: Auth) => useRootRedirect(auth), { initialProps: signedIn });
    await flush();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    mockRootState = MOUNTED_STATE;
    rerender(signedIn);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/onboarding/step1-identity'));
  });

  it('after signing in from the deep link she lands on the page she asked for', async () => {
    mockRootState = MOUNTED_STATE;
    at(['notifications'], '/notifications');
    const { rerender } = renderHook((auth: Auth) => useRootRedirect(auth), { initialProps: signedOut });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/code'));

    at(['(auth)', 'welcome'], '/welcome');
    rerender(signedOut);
    rerender(signedIn);
    await waitFor(() => expect(mockReplace).toHaveBeenLastCalledWith('/notifications'));
    expect(mockSetProfile).toHaveBeenCalledWith(MEMBER);
  });

  // A password reset signs her in on a screen inside the app, so the first
  // signed-in decision is not an auth-screen one. The return-to must still be
  // spent there, or it ambushes a later trip through an auth screen (review).
  it('a sign-in that lands inside the app spends the return-to too', async () => {
    mockRootState = MOUNTED_STATE;
    at(['notifications'], '/notifications');
    const { rerender } = renderHook((auth: Auth) => useRootRedirect(auth), { initialProps: signedOut });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/code'));

    at(['(tabs)', 'feed'], '/feed');
    rerender(signedIn);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await flush();
    mockReplace.mockClear();

    mockProfileState.profile = null;
    at(['(auth)', 'welcome'], '/welcome');
    rerender({ ...signedIn });
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/feed');
  });

  it('signing out is not a deep link: the next sign-in lands on the feed, not the page she left', async () => {
    mockRootState = MOUNTED_STATE;
    at(['(tabs)', 'you', 'settings'], '/you/settings');
    mockProfileState.profile = { id: 'u1', onboarding_completed: true };
    const { rerender } = renderHook((auth: Auth) => useRootRedirect(auth), { initialProps: signedIn });
    await flush();
    expect(mockReplace).not.toHaveBeenCalled();

    mockProfileState.profile = null;
    rerender(signedOut);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/code'));

    at(['(auth)', 'welcome'], '/welcome');
    rerender(signedOut);
    rerender(signedIn);
    await waitFor(() => expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/feed'));
  });
});

describe('useRootRedirect — Bug B: Back onto the code screen after signing in', () => {
  it('an approved member on /code is sent home, never left on the applicant screen', async () => {
    mockRootState = MOUNTED_STATE;
    at(['(auth)', 'code'], '/code');
    renderHook((auth: Auth) => useRootRedirect(auth), { initialProps: signedIn });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/feed'));
  });

  it('G-15 is untouched: signed in with no profile and no held code, she stays on /code', async () => {
    mockRootState = MOUNTED_STATE;
    at(['(auth)', 'code'], '/code');
    mockFetch.mockResolvedValue({ data: null, error: null });
    renderHook((auth: Auth) => useRootRedirect(auth), { initialProps: signedIn });
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await flush();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
