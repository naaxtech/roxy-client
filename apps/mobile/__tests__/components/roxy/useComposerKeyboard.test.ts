/**
 * The keyboard height Roxy AI's composer rides (motion spec F14). On web the
 * on-screen keyboard shrinks only the visual viewport, so the overlap is read
 * from `window.visualViewport`; pinch-zoom is not a keyboard.
 */
import { renderHook, act } from '@testing-library/react-native';
import {
  keyboardOverlap, useWebComposerKeyboard, useComposerKeyboard,
} from '../../../components/roxy/useComposerKeyboard';

describe('keyboardOverlap', () => {
  it('is the layout viewport below the visual one', () => {
    expect(keyboardOverlap(844, { height: 544, offsetTop: 0, scale: 1 })).toBe(300);
  });

  it('counts a visual viewport the page has scrolled within', () => {
    expect(keyboardOverlap(844, { height: 544, offsetTop: 40, scale: 1 })).toBe(260);
  });

  it('is nothing while she pinch-zooms (the visual viewport shrinks, no keyboard)', () => {
    expect(keyboardOverlap(844, { height: 422, offsetTop: 100, scale: 2 })).toBe(0);
  });

  it('is never negative and lands on whole pixels', () => {
    expect(keyboardOverlap(800, { height: 812.4, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardOverlap(800, { height: 499.6, offsetTop: 0, scale: 1 })).toBe(300);
  });
});

describe('useWebComposerKeyboard', () => {
  type Listener = () => void;
  function fakeViewport(height: number) {
    const listeners: Record<string, Listener[]> = {};
    return {
      height, offsetTop: 0, scale: 1,
      addEventListener: (type: string, fn: Listener) => { (listeners[type] ||= []).push(fn); },
      removeEventListener: (type: string, fn: Listener) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
      },
      fire(type: string) { (listeners[type] || []).forEach((fn) => fn()); },
      count: () => Object.values(listeners).reduce((n, l) => n + l.length, 0),
    };
  }
  const w = window as unknown as { visualViewport?: unknown; innerHeight: number };
  const saved = { vv: w.visualViewport, inner: w.innerHeight };

  afterEach(() => {
    w.visualViewport = saved.vv;
    w.innerHeight = saved.inner;
  });

  it('follows the visual viewport as the keyboard opens and closes, and lets go on unmount', () => {
    const vv = fakeViewport(844);
    w.visualViewport = vv;
    w.innerHeight = 844;
    const { result, unmount } = renderHook(() => useWebComposerKeyboard());
    expect(result.current.value).toBe(0);

    act(() => { vv.height = 544; vv.fire('resize'); });
    expect(result.current.value).toBe(300);

    act(() => { vv.height = 844; vv.fire('resize'); });
    expect(result.current.value).toBe(0);

    unmount();
    expect(vv.count()).toBe(0);
  });

  it('stays at 0 where there is no visual viewport', () => {
    w.visualViewport = undefined;
    const { result } = renderHook(() => useWebComposerKeyboard());
    expect(result.current.value).toBe(0);
  });
});

it('native builds read the keyboard from reanimated (jest runs as iOS)', () => {
  expect(useComposerKeyboard).not.toBe(useWebComposerKeyboard);
});
