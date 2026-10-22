import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

/**
 * F14 (motion spec §2): in a chat the composer rides the keyboard frame by
 * frame. Native: reanimated's `useAnimatedKeyboard` drives a spacer under the
 * composer on the UI thread (iOS, Android 11+). Android 10 and below keep the
 * system resize, because the hook's tracking is unreliable there and, while
 * mounted, it switches the resize off for the whole app (spec §4.1). Mobile
 * web: the composer sits on `visualViewport`.
 */

const mockUseAnimatedKeyboard = jest.fn(() => ({ height: { value: 300 }, state: { value: 2 } }));
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useAnimatedKeyboard: (...a: unknown[]) => mockUseAnimatedKeyboard(...(a as [])),
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
  };
});

import {
  KeyboardTrackingView, keyboardMode, keyboardOverlap, ANDROID_TRACKING_MIN_API,
} from '../../../components/chat/KeyboardTrackingView';

const realOS = Platform.OS;
const setPlatform = (os: string, version: number | string) => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
};

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
  mockUseAnimatedKeyboard.mockClear();
});

describe('keyboardMode', () => {
  it('tracks on iOS and on Android 11+, keeps the system resize below, follows the viewport on web', () => {
    expect(ANDROID_TRACKING_MIN_API).toBe(30);
    expect(keyboardMode('ios', '17.4')).toBe('track');
    expect(keyboardMode('android', 30)).toBe('track');
    expect(keyboardMode('android', 34)).toBe('track');
    expect(keyboardMode('android', 29)).toBe('legacy');
    expect(keyboardMode('web', '')).toBe('web');
  });
});

describe('keyboardOverlap (web)', () => {
  it('is the part of the layout viewport the keyboard covers, never negative', () => {
    expect(keyboardOverlap(844, { height: 500, offsetTop: 0 })).toBe(344);
    // iOS scrolled the page to keep the field visible.
    expect(keyboardOverlap(844, { height: 500, offsetTop: 100 })).toBe(244);
    expect(keyboardOverlap(844, { height: 844, offsetTop: 0 })).toBe(0);
    expect(keyboardOverlap(844, { height: 900, offsetTop: 0 })).toBe(0);
  });
});

describe('KeyboardTrackingView', () => {
  it('on iOS a spacer under the content follows the keyboard height (UI thread)', () => {
    setPlatform('ios', '17.4');
    const v = render(<KeyboardTrackingView testID="kb"><Text>composer</Text></KeyboardTrackingView>);
    expect(mockUseAnimatedKeyboard).toHaveBeenCalledWith({ isStatusBarTranslucentAndroid: true });
    expect(StyleSheet.flatten(v.getByTestId('kb-spacer').props.style).height).toBe(300);
  });

  it('on Android 10 it never mounts the keyboard hook (the app keeps its resize)', () => {
    setPlatform('android', 29);
    const v = render(<KeyboardTrackingView testID="kb"><Text>composer</Text></KeyboardTrackingView>);
    expect(mockUseAnimatedKeyboard).not.toHaveBeenCalled();
    expect(v.queryByTestId('kb-spacer')).toBeNull();
    expect(v.getByText('composer')).toBeTruthy();
  });

  it('on Android 11+ it tracks', () => {
    setPlatform('android', 31);
    const v = render(<KeyboardTrackingView testID="kb"><Text>composer</Text></KeyboardTrackingView>);
    expect(mockUseAnimatedKeyboard).toHaveBeenCalled();
    expect(v.getByTestId('kb-spacer')).toBeTruthy();
  });

  it('on mobile web the bottom inset follows visualViewport', () => {
    setPlatform('web', '');
    const listeners: Record<string, Array<() => void>> = {};
    const vv = {
      height: 844, offsetTop: 0,
      addEventListener: (t: string, f: () => void) => { (listeners[t] ||= []).push(f); },
      removeEventListener: jest.fn(),
    };
    const w = globalThis as unknown as { visualViewport?: unknown; innerHeight: number; requestAnimationFrame: (f: () => void) => number };
    const prevVV = w.visualViewport;
    const prevRaf = w.requestAnimationFrame;
    w.visualViewport = vv;
    w.innerHeight = 844;
    w.requestAnimationFrame = (f) => { f(); return 1; };
    try {
      const v = render(<KeyboardTrackingView testID="kb"><Text>composer</Text></KeyboardTrackingView>);
      expect(StyleSheet.flatten(v.getByTestId('kb').props.style).paddingBottom ?? 0).toBe(0);
      vv.height = 500;
      act(() => { listeners.resize.forEach((f) => f()); });
      expect(StyleSheet.flatten(v.getByTestId('kb').props.style).paddingBottom).toBe(344);
      vv.height = 844;
      act(() => { listeners.resize.forEach((f) => f()); });
      expect(StyleSheet.flatten(v.getByTestId('kb').props.style).paddingBottom).toBe(0);
      expect(mockUseAnimatedKeyboard).not.toHaveBeenCalled();
    } finally {
      w.visualViewport = prevVV;
      w.requestAnimationFrame = prevRaf;
    }
  });
});
