import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { usePlaybackAllowed } from '../../hooks/usePlaybackAllowed';

/**
 * FEED-03: tabs keep their screens mounted, so a clip kept playing — with
 * sound if unmuted — behind Messages or a pushed profile. The hook is the one
 * switch every video cell now obeys: focused AND foreground.
 */

type Listener = () => void;

function fakeNavigation(initiallyFocused: boolean) {
  const listeners: Record<string, Listener[]> = { focus: [], blur: [] };
  let focused = initiallyFocused;
  return {
    isFocused: () => focused,
    addListener: (event: 'focus' | 'blur', cb: Listener) => {
      listeners[event].push(cb);
      return () => { listeners[event] = listeners[event].filter((l) => l !== cb); };
    },
    emit(event: 'focus' | 'blur') {
      focused = event === 'focus';
      listeners[event].forEach((cb) => cb());
    },
    listenerCount: () => listeners.focus.length + listeners.blur.length,
  };
}

function Probe(): React.ReactElement {
  return <Text testID="allowed">{String(usePlaybackAllowed())}</Text>;
}

let appStateCb: ((next: string) => void) | null = null;
const removeSub = jest.fn();

beforeEach(() => {
  appStateCb = null;
  removeSub.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string, cb: (next: string) => void,
  ) => {
    appStateCb = cb;
    return { remove: removeSub };
  }) as unknown as typeof AppState.addEventListener);
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function mount(nav: ReturnType<typeof fakeNavigation> | null) {
  return render(
    <NavigationContext.Provider value={nav as never}>
      <Probe />
    </NavigationContext.Provider>,
  );
}

describe('usePlaybackAllowed', () => {
  it('allows playback with no navigator around it (previews, tests)', () => {
    const view = mount(null);
    expect(view.getByTestId('allowed').props.children).toBe('true');
  });

  it('allows playback on a focused screen in the foreground', () => {
    const view = mount(fakeNavigation(true));
    expect(view.getByTestId('allowed').props.children).toBe('true');
  });

  it('stops playback when the screen blurs (another tab, a pushed profile)', () => {
    const nav = fakeNavigation(true);
    const view = mount(nav);

    act(() => nav.emit('blur'));
    expect(view.getByTestId('allowed').props.children).toBe('false');

    act(() => nav.emit('focus'));
    expect(view.getByTestId('allowed').props.children).toBe('true');
  });

  it('starts paused when the screen mounts already blurred', () => {
    const view = mount(fakeNavigation(false));
    expect(view.getByTestId('allowed').props.children).toBe('false');
  });

  it('stops playback when the app goes to the background, and resumes on return', () => {
    const view = mount(fakeNavigation(true));

    act(() => appStateCb?.('background'));
    expect(view.getByTestId('allowed').props.children).toBe('false');

    act(() => appStateCb?.('active'));
    expect(view.getByTestId('allowed').props.children).toBe('true');
  });

  it('treats "inactive" (control centre, an incoming call) as not playing', () => {
    const view = mount(fakeNavigation(true));

    act(() => appStateCb?.('inactive'));
    expect(view.getByTestId('allowed').props.children).toBe('false');
  });

  it('removes its listeners on unmount', () => {
    const nav = fakeNavigation(true);
    const view = mount(nav);
    expect(nav.listenerCount()).toBe(2);

    view.unmount();
    expect(nav.listenerCount()).toBe(0);
    expect(removeSub).toHaveBeenCalled();
  });
});
