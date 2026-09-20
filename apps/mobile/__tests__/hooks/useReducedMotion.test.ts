import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type ReduceMotionHandler = (enabled: boolean) => void;

let handlers: ReduceMotionHandler[] = [];
let removeCalls = 0;

beforeEach(() => {
  handlers = [];
  removeCalls = 0;
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation(((event: string, handler: ReduceMotionHandler) => {
      if (event === 'reduceMotionChanged') handlers.push(handler);
      return { remove: () => { removeCalls += 1; } };
    }) as unknown as typeof AccessibilityInfo.addEventListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function mockInitial(enabled: boolean) {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(enabled);
}

describe('useReducedMotion', () => {
  it('starts false so motion is never suppressed before the platform answers', async () => {
    mockInitial(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    // Settle the pending isReduceMotionEnabled promise inside act() so the
    // resolved state update does not land after the test has finished.
    await act(async () => {});
  });

  it('reports true when reduce motion is already on at mount', async () => {
    mockInitial(true);
    const { result } = renderHook(() => useReducedMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('reports false when reduce motion is off at mount', async () => {
    mockInitial(false);
    const { result } = renderHook(() => useReducedMotion());
    await waitFor(() => expect(result.current).toBe(false));
    expect(handlers).toHaveLength(1);
  });

  it('follows a reduceMotionChanged event while mounted', async () => {
    mockInitial(false);
    const { result } = renderHook(() => useReducedMotion());
    await waitFor(() => expect(handlers).toHaveLength(1));

    act(() => { handlers[0](true); });
    expect(result.current).toBe(true);

    act(() => { handlers[0](false); });
    expect(result.current).toBe(false);
  });

  it('removes its listener on unmount', async () => {
    mockInitial(false);
    const { unmount } = renderHook(() => useReducedMotion());
    await waitFor(() => expect(handlers).toHaveLength(1));
    unmount();
    expect(removeCalls).toBe(1);
  });
});
