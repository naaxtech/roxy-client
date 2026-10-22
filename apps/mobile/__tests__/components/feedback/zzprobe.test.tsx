/**
 * Facts about reanimated 3.10's jest implementation that the Wave 3
 * feedback primitives (and their tests) rely on. Written while building
 * PressableScale v3; kept so other lanes' tests do not rediscover them.
 *
 * 1. `createAnimatedComponent` exists only on reanimated's DEFAULT export
 *    (`Animated.createAnimatedComponent`), not as a named export.
 * 2. In jest, an animated style object reports to ONE component: the last one
 *    it was attached to. Give each animated host its own `useAnimatedStyle`.
 * 3. A shared-value change reaches `getAnimatedStyle` after a frame
 *    (`jest.advanceTimersByTime(16)` under fake timers), not synchronously.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import * as ReanimatedModule from 'react-native-reanimated';
import Reanimated, { getAnimatedStyle, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);

function TwoHosts() {
  const v = useSharedValue(0);
  const forPressable = useAnimatedStyle(() => ({ opacity: v.value }));
  const forView = useAnimatedStyle(() => ({ opacity: v.value }));
  return (
    <>
      <AnimatedPressable testID="ap" style={[{ width: 3 }, forPressable]} onPressIn={() => { v.value = 0.5; }}>
        <Text>x</Text>
      </AnimatedPressable>
      <Reanimated.View testID="av" style={[{ width: 3 }, forView]} />
    </>
  );
}

describe('reanimated jest harness', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('exposes createAnimatedComponent on the default export only', () => {
    expect(typeof Reanimated.createAnimatedComponent).toBe('function');
    expect((ReanimatedModule as Record<string, unknown>).createAnimatedComponent).toBeUndefined();
  });

  it('animates an animated Pressable host after one frame', () => {
    const r = render(<TwoHosts />);
    act(() => { fireEvent(r.getByTestId('ap'), 'pressIn', { nativeEvent: {} }); });
    act(() => { jest.advanceTimersByTime(16); });
    expect(getAnimatedStyle(r.getByTestId('ap') as never)).toMatchObject({ width: 3, opacity: 0.5 });
    expect(getAnimatedStyle(r.getByTestId('av') as never)).toMatchObject({ width: 3, opacity: 0.5 });
  });
});
