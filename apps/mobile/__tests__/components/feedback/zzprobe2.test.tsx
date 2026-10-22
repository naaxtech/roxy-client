/**
 * PressableScale under the partial reanimated mocks other suites use
 * (e.g. WelcomeIn: `{ default: { View }, useSharedValue, useAnimatedStyle,
 * withSpring, withTiming }`, no `createAnimatedComponent`). The 147 importers'
 * suites must keep rendering and pressing: the hosts fall back to plain RN
 * views and the styles stay static.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    withTiming: (value: number) => value,
    withSpring: (value: number) => value,
  };
});

import { PressableScale } from '../../../components/ui/PressableScale';

describe('PressableScale with a partial reanimated mock', () => {
  it('renders, presses and fires onPress', () => {
    const onPress = jest.fn();
    const v = render(
      <PressableScale testID="p" onPress={onPress} style={{ borderRadius: 999 }}>
        <Text>Go</Text>
      </PressableScale>,
    );
    act(() => { fireEvent(v.getByTestId('p'), 'pressIn', { nativeEvent: {} }); });
    act(() => { fireEvent(v.getByTestId('p'), 'pressOut', { nativeEvent: {} }); });
    fireEvent.press(v.getByTestId('p'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(v.getByText('Go')).toBeTruthy();
    expect(v.getByTestId('press-state-layer')).toBeTruthy();
  });
});
