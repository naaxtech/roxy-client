/**
 * The navigator-ready signal the root redirects wait on.
 *
 * The first version read `useRootNavigationState()`. In expo-router 3.5 that
 * hook syncs the store during render (`syncStoreRootState` →
 * `navigationRef.getRootState()`), and react-navigation builds a new state
 * object on every `getRootState()` call, so the store saw a "new" state on
 * every render, notified its subscribers and re-rendered the caller: React's
 * "Maximum update depth exceeded" in <RootRedirects>, and a blank page on every
 * load of the local export (2026-10-28). jest could not see it because the hook
 * was mocked. This test makes that hook unusable here.
 */
import { renderHook, act } from '@testing-library/react-native';

let mockReady = false;
const mockRef = { isReady: jest.fn(() => mockReady) };
jest.mock('expo-router', () => ({
  useNavigationContainerRef: () => mockRef,
  useRootNavigationState: () => {
    throw new Error('useRootNavigationState re-renders its caller on every render (expo-router 3.5); do not use it here');
  },
}));

import { useRootNavigatorReady } from '../../hooks/useRootNavigatorReady';

beforeEach(() => {
  jest.useFakeTimers();
  mockReady = false;
  mockRef.isReady.mockClear();
});
afterEach(() => { jest.useRealTimers(); });

describe('useRootNavigatorReady', () => {
  it('is false until the navigation container reports a mounted navigator, then true', () => {
    const { result } = renderHook(() => useRootNavigatorReady());
    expect(result.current).toBe(false);

    act(() => { jest.advanceTimersByTime(200); });
    expect(result.current).toBe(false);

    mockReady = true;
    act(() => { jest.advanceTimersByTime(200); });
    expect(result.current).toBe(true);
  });

  it('is true at once when the navigator is already mounted', () => {
    mockReady = true;
    const { result } = renderHook(() => useRootNavigatorReady());
    expect(result.current).toBe(true);
  });

  it('stops checking once ready, and when unmounted', () => {
    const { result, unmount } = renderHook(() => useRootNavigatorReady());
    mockReady = true;
    act(() => { jest.advanceTimersByTime(200); });
    expect(result.current).toBe(true);
    const calls = mockRef.isReady.mock.calls.length;
    act(() => { jest.advanceTimersByTime(2000); });
    expect(mockRef.isReady.mock.calls.length).toBe(calls);

    mockReady = false;
    const second = renderHook(() => useRootNavigatorReady());
    second.unmount();
    const after = mockRef.isReady.mock.calls.length;
    act(() => { jest.advanceTimersByTime(2000); });
    expect(mockRef.isReady.mock.calls.length).toBe(after);
    unmount();
  });
});
