/**
 * The root-level redirect into "You're in" (G-11): a just-approved member is
 * sent there exactly once, whether she was approved while the app was closed
 * (cold start) or while she was waiting inside it (live flip).
 */
import { renderHook, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
let mockSegments: string[] = ['(tabs)', 'feed'];
let mockPathname = '/feed';
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSegments: () => mockSegments,
  usePathname: () => mockPathname,
}));

const mockShouldGreet = jest.fn();
jest.mock('../../lib/welcomeIn', () => ({
  shouldGreetNewMember: (...args: unknown[]) => mockShouldGreet(...args),
}));

const mockAuth = { user: { id: 'u1' } as { id: string } | null };
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: typeof mockAuth) => unknown) => sel(mockAuth),
}));
type P = { vetting_status: string; onboarding_completed: boolean } | null;
const mockProfile: { profile: P } = { profile: null };
jest.mock('../../store/profileStore', () => ({
  useProfileStore: (sel: (s: typeof mockProfile) => unknown) => sel(mockProfile),
}));
const mockViewAs: { preview: string | null } = { preview: null };
jest.mock('../../store/viewAsStore', () => ({
  useViewAsStore: (sel: (s: typeof mockViewAs) => unknown) => sel(mockViewAs),
}));

import { useWelcomeInRedirect } from '../../hooks/useWelcomeInRedirect';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  mockSegments = ['(tabs)', 'feed'];
  mockPathname = '/feed';
  mockAuth.user = { id: 'u1' };
  mockProfile.profile = { vetting_status: 'approved', onboarding_completed: true };
  mockViewAs.preview = null;
  mockShouldGreet.mockResolvedValue(true);
});

describe('useWelcomeInRedirect', () => {
  it('sends a freshly approved member to the welcome', async () => {
    renderHook(() => useWelcomeInRedirect());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/welcome-in'));
    expect(mockShouldGreet).toHaveBeenCalledWith('u1');
  });

  it('does not redirect when the greeting is not due (seen, old, or no application)', async () => {
    mockShouldGreet.mockResolvedValue(false);
    renderHook(() => useWelcomeInRedirect());
    await flush();
    await flush();
    expect(mockShouldGreet).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('asks once per user and status, not on every navigation', async () => {
    mockShouldGreet.mockResolvedValue(false);
    const { rerender } = renderHook(() => useWelcomeInRedirect());
    await flush();
    mockSegments = ['(tabs)', 'discover'];
    mockPathname = '/discover';
    rerender({});
    await flush();
    expect(mockShouldGreet).toHaveBeenCalledTimes(1);
  });

  it('a live approval (pending -> approved in the store) is checked again', async () => {
    mockProfile.profile = { vetting_status: 'pending', onboarding_completed: true };
    const { rerender } = renderHook(() => useWelcomeInRedirect());
    await flush();
    expect(mockShouldGreet).not.toHaveBeenCalled();

    mockProfile.profile = { vetting_status: 'approved', onboarding_completed: true };
    rerender({});
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/welcome-in'));
  });

  it('never while a core account is previewing another kind', async () => {
    mockViewAs.preview = 'member';
    renderHook(() => useWelcomeInRedirect());
    await flush();
    expect(mockShouldGreet).not.toHaveBeenCalled();
  });

  it('never from an auth screen (onboarding finishes first)', async () => {
    mockSegments = ['(auth)', 'onboarding', 'step3'];
    mockPathname = '/onboarding/step3';
    renderHook(() => useWelcomeInRedirect());
    await flush();
    expect(mockShouldGreet).not.toHaveBeenCalled();
  });

  it('signed out: nothing', async () => {
    mockAuth.user = null;
    renderHook(() => useWelcomeInRedirect());
    await flush();
    expect(mockShouldGreet).not.toHaveBeenCalled();
  });

  it('a check that resolves after she navigated into auth does not yank her out', async () => {
    let resolve: (v: boolean) => void = () => undefined;
    mockShouldGreet.mockImplementation(() => new Promise<boolean>((r) => { resolve = r; }));
    const { unmount } = renderHook(() => useWelcomeInRedirect());
    await flush();
    unmount();
    resolve(true);
    await flush();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
