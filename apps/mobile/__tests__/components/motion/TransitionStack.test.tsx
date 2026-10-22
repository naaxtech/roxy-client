/**
 * TransitionStack: the stack every Roxy layout uses (motion spec §3.1 row 5,
 * F3, F12).
 *
 * Native: React Navigation's native-stack with the motion set explicitly —
 * the platform's default push (iOS slide + parallax with swipe-back, Android's
 * system transition) and gestures on; under Reduce Motion a 120 ms fade.
 * Web: the same navigator state rendered by WebTransitionStackView, so
 * roxy.expo.app moves the way the app does instead of jump-cutting.
 */
import React from 'react';
import { Platform, Text, View } from 'react-native';
import { render } from '@testing-library/react-native';
import { NavigationContainer, createNavigatorFactory } from '@react-navigation/native';

const mockReduced = jest.fn(() => false);
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced() }));

const mockNativeProps: Record<string, unknown>[] = [];
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: (p: Record<string, unknown>) => {
      mockNativeProps.push(p);
      return null;
    },
  }),
}));

const mockWebDescriptors: Record<string, { options: Record<string, unknown> }>[] = [];
jest.mock('../../../components/motion/WebTransitionStackView', () => {
  const { View: RNView } = require('react-native');
  return {
    WebTransitionStackView: (p: {
      state: { routes: { key: string }[] };
      descriptors: Record<string, { options: Record<string, unknown>; render: () => React.ReactNode }>;
    }) => {
      mockWebDescriptors.push(p.descriptors);
      return <RNView testID="web-transition-stack">{p.state.routes.map((r) => p.descriptors[r.key].render())}</RNView>;
    },
  };
});

import {
  TransitionStackNavigator, withStackDefaults,
} from '../../../components/motion/TransitionStack';

const originalOS = Platform.OS;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS });
  mockNativeProps.length = 0;
  mockWebDescriptors.length = 0;
  mockReduced.mockReturnValue(false);
});

const Stack = createNavigatorFactory(TransitionStackNavigator)();
const Home = () => <Text>home</Text>;

describe('withStackDefaults', () => {
  it('sets the platform default push, gestures on, no header', () => {
    expect(withStackDefaults(undefined, false)).toEqual({
      headerShown: false, animation: 'default', gestureEnabled: true,
    });
  });

  it('Reduce Motion: a 120 ms fade instead of a slide', () => {
    expect(withStackDefaults(undefined, true)).toEqual({
      headerShown: false, animation: 'fade', animationDuration: 120, gestureEnabled: true,
    });
  });

  it("keeps a layout's own options (e.g. modal presentation) on top of the defaults", () => {
    expect(withStackDefaults({ headerShown: false, presentation: 'modal' }, false)).toEqual({
      headerShown: false, animation: 'default', gestureEnabled: true, presentation: 'modal',
    });
  });

  it('Reduce Motion still wins over an explicit slide, but not over "none"', () => {
    expect(withStackDefaults({ animation: 'slide_from_bottom' }, true)).toEqual(
      expect.objectContaining({ animation: 'fade', animationDuration: 120 }),
    );
    expect(withStackDefaults({ animation: 'none' }, true)).toEqual(expect.objectContaining({ animation: 'none' }));
  });

  it('merges a screenOptions function per screen', () => {
    const fn = withStackDefaults(() => ({ presentation: 'modal' }), false) as (p: unknown) => unknown;
    expect(fn({ route: { key: 'x', name: 'x' }, navigation: {} })).toEqual({
      headerShown: false, animation: 'default', gestureEnabled: true, presentation: 'modal',
    });
  });
});

describe('TransitionStackNavigator', () => {
  it('native: the native stack, with the explicit motion options', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    render(
      <NavigationContainer>
        <TransitionStackNavigator screenOptions={{ headerShown: false }}>
          <View />
        </TransitionStackNavigator>
      </NavigationContainer>,
    );
    expect(mockNativeProps[mockNativeProps.length - 1].screenOptions).toEqual({
      headerShown: false, animation: 'default', gestureEnabled: true,
    });
  });

  it('native, Reduce Motion: the native stack fades', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    mockReduced.mockReturnValue(true);
    render(
      <NavigationContainer>
        <TransitionStackNavigator>
          <View />
        </TransitionStackNavigator>
      </NavigationContainer>,
    );
    expect(mockNativeProps[mockNativeProps.length - 1].screenOptions).toEqual(
      expect.objectContaining({ animation: 'fade', animationDuration: 120 }),
    );
  });

  it('web: renders the stack through WebTransitionStackView with the same options', () => {
    Object.defineProperty(Platform, 'OS', { value: 'web' });
    const { getByTestId, getByText } = render(
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="home" component={Home} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
    expect(getByTestId('web-transition-stack')).toBeTruthy();
    expect(getByText('home')).toBeTruthy();
    const options = Object.values(mockWebDescriptors[mockWebDescriptors.length - 1])[0].options;
    expect(options).toEqual(expect.objectContaining({ headerShown: false, animation: 'default', gestureEnabled: true }));
    expect(mockNativeProps).toHaveLength(0);
  });
});
