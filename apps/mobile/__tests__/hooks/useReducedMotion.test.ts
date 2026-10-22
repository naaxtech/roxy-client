/**
 * `useReducedMotion` — one module-level store (polish/motion-spec.md §4.1).
 *
 * The old hook started `false` and subscribed once per instance (500+ with
 * PressableScale), so the first frame animated for a member who asked for
 * less motion. The store now starts from reanimated's launch value
 * (synchronous: the native global / `prefers-reduced-motion` on web) and one
 * AccessibilityInfo listener keeps it live for every caller. The hook's API is
 * unchanged: `useReducedMotion(): boolean`.
 *
 * Each test loads a fresh copy of the module (and of React, RN and the testing
 * library with it, so they share one React).
 */
type Handler = (enabled: boolean) => void;

type Loaded = {
  hook: typeof import('../../hooks/useReducedMotion');
  rtl: typeof import('@testing-library/react-native/pure');
  handlers: Handler[];
  addCalls: () => number;
  resolveInitial: (v: boolean) => void;
};

const cleanups: (() => void)[] = [];

function load({ launch, initial }: { launch: boolean; initial?: boolean }): Loaded {
  const handlers: Handler[] = [];
  let adds = 0;
  let resolveInitial: (v: boolean) => void = () => {};
  let loaded: Loaded | undefined;
  jest.isolateModules(() => {
    jest.doMock('react-native-reanimated', () => ({ useReducedMotion: () => launch }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RN = require('react-native');
    jest.spyOn(RN.AccessibilityInfo, 'addEventListener').mockImplementation(((event: string, h: Handler) => {
      adds += 1;
      if (event === 'reduceMotionChanged') handlers.push(h);
      return { remove: () => {} };
    }) as never);
    jest.spyOn(RN.AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() =>
      initial === undefined
        ? new Promise<boolean>((res) => { resolveInitial = res; })
        : Promise.resolve(initial),
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const hook = require('../../hooks/useReducedMotion');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rtl = require('@testing-library/react-native/pure');
    cleanups.push(rtl.cleanup);
    loaded = { hook, rtl, handlers, addCalls: () => adds, resolveInitial: (v) => resolveInitial(v) };
  });
  return loaded as Loaded;
}

afterEach(() => {
  cleanups.splice(0).forEach((c) => c());
  jest.restoreAllMocks();
  jest.dontMock('react-native-reanimated');
});

describe('useReducedMotion store', () => {
  it('is TRUE on the very first render when Reduce Motion was on at launch (no async wait)', () => {
    const { hook, rtl } = load({ launch: true });
    const { result } = rtl.renderHook(() => hook.useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('is false on the first render when it was off at launch', () => {
    const { hook, rtl } = load({ launch: false });
    const { result } = rtl.renderHook(() => hook.useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('reads the same value outside React (getReducedMotion)', () => {
    const { hook } = load({ launch: true });
    expect(hook.getReducedMotion()).toBe(true);
  });

  it('registers ONE AccessibilityInfo listener however many components read it', () => {
    const { hook, rtl, addCalls } = load({ launch: false });
    for (let i = 0; i < 5; i += 1) rtl.renderHook(() => hook.useReducedMotion());
    expect(addCalls()).toBe(1);
  });

  it('follows the OS setting live, for every mounted reader at once', () => {
    const { hook, rtl, handlers } = load({ launch: false });
    const a = rtl.renderHook(() => hook.useReducedMotion());
    const b = rtl.renderHook(() => hook.useReducedMotion());
    expect(handlers).toHaveLength(1);

    rtl.act(() => { handlers[0](true); });
    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(true);
    expect(hook.getReducedMotion()).toBe(true);

    rtl.act(() => { handlers[0](false); });
    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(false);
  });

  it('lets the platform answer correct the launch value', async () => {
    const { hook, rtl, resolveInitial } = load({ launch: false });
    const { result } = rtl.renderHook(() => hook.useReducedMotion());
    expect(result.current).toBe(false);
    await rtl.act(async () => { resolveInitial(true); });
    expect(result.current).toBe(true);
  });

  it('a missing platform answer (jest RN mock) keeps the launch value', async () => {
    const { hook, rtl, resolveInitial } = load({ launch: true });
    const { result } = rtl.renderHook(() => hook.useReducedMotion());
    await rtl.act(async () => { resolveInitial(undefined as unknown as boolean); });
    expect(result.current).toBe(true);
  });

  it('stops notifying a reader once it unsubscribes', () => {
    const { hook, rtl, handlers } = load({ launch: false });
    const seen: boolean[] = [];
    const unsubscribe = hook.subscribeReducedMotion(() => seen.push(hook.getReducedMotion()));
    const { unmount } = rtl.renderHook(() => hook.useReducedMotion());
    unmount();
    rtl.act(() => { handlers[0](true); });
    unsubscribe();
    rtl.act(() => { handlers[0](false); });
    expect(seen).toEqual([true]);
  });
});
