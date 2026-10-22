import React from 'react';
import { StyleSheet, View, processColor } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Switch, SWITCH } from '../../../components/ui/Switch';
import { Snackbar, SNACKBAR_DURATION } from '../../../components/ui/Snackbar';
import { THEMES } from '../../../lib/theme';
import { useThemeStore } from '../../../store/themeStore';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

const light = THEMES.light;
/** The switch paints colours from reanimated (rgba strings): compare as native colour ints. */
const sameColour = (a: unknown, b: string) => processColor(a as string) === processColor(b);

beforeEach(() => {
  useThemeStore.setState({ theme: 'light', choice: 'light' });
});

/**
 * The M3 switch (design direction v2 › Settings): 52 × 32. On = `pink` track,
 * white thumb; off = `raised` track with a `control` outline and thumb. The
 * thumb grows while pressed. It is a real 48 dp target and a real `switch`
 * for assistive technology.
 */
describe('Switch', () => {
  it('is a switch with its state for a screen reader', () => {
    const { getByTestId, rerender } = render(<Switch testID="sw" value accessibilityLabel="Roxy AI" />);
    const node = getByTestId('sw');
    expect(node.props.accessibilityRole).toBe('switch');
    expect(node.props.accessibilityState).toMatchObject({ checked: true });
    expect(node.props.accessibilityLabel).toBe('Roxy AI');
    rerender(<Switch testID="sw" value={false} accessibilityLabel="Roxy AI" />);
    expect(getByTestId('sw').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('a tap asks for the other value', () => {
    const onValueChange = jest.fn();
    const { getByTestId } = render(<Switch testID="sw" value onValueChange={onValueChange} />);
    fireEvent.press(getByTestId('sw'));
    expect(onValueChange).toHaveBeenCalledWith(false);
  });

  it('still answers the RN Switch event shape (valueChange)', () => {
    const onValueChange = jest.fn();
    // Nested, as on a real screen: RNTL stops its handler walk at the root.
    const { getByTestId } = render(
      <View><Switch testID="sw" value={false} onValueChange={onValueChange} /></View>,
    );
    fireEvent(getByTestId('sw'), 'valueChange', true);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('a disabled switch does nothing', () => {
    const onValueChange = jest.fn();
    const { getByTestId } = render(<Switch testID="sw" value disabled onValueChange={onValueChange} />);
    fireEvent.press(getByTestId('sw'));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(getByTestId('sw').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('on: pink track, white thumb', () => {
    const { getByTestId } = render(<Switch testID="sw" value />);
    const track = flat(getByTestId('sw-track'));
    expect(track.width).toBe(SWITCH.width);
    expect(track.height).toBe(SWITCH.height);
    expect(sameColour(track.backgroundColor, light.pink)).toBe(true);
    expect(sameColour(flat(getByTestId('sw-thumb')).backgroundColor, '#FFFFFF')).toBe(true);
  });

  it('off: raised track with a control outline and a control thumb', () => {
    const { getByTestId } = render(<Switch testID="sw" value={false} />);
    const track = flat(getByTestId('sw-track'));
    expect(sameColour(track.backgroundColor, light.raised)).toBe(true);
    expect(sameColour(track.borderColor, light.control)).toBe(true);
    expect(track.borderWidth).toBe(SWITCH.outline);
    expect(sameColour(flat(getByTestId('sw-thumb')).backgroundColor, light.control)).toBe(true);
  });

  it('measures a real 48 dp target without hitSlop', () => {
    const { getByTestId } = render(<Switch testID="sw" value />);
    const node = getByTestId('sw');
    expect(Number(flat(node).minHeight)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(node.props.hitSlop).toBeUndefined();
  });

  // Wave 3: the thumb is one 24 dp disc scaled to its size (UI thread, no
  // relayout); the press growth itself is timed in SwitchMotion.test.tsx.
  it('the thumb is 20 dp on at rest (a 24 dp disc at 20/24)', () => {
    const { getByTestId } = render(<Switch testID="sw" value />);
    const thumb = flat(getByTestId('sw-thumb'));
    expect(thumb.width).toBe(SWITCH.thumbPressed);
    const scale = (thumb.transform as Record<string, number>[]).find((t) => 'scale' in t)?.scale;
    expect(scale).toBeCloseTo(SWITCH.thumbOn / SWITCH.thumbPressed, 3);
  });
});

/**
 * The snackbar (design direction v2 › Color: `inverse` / `onInverse` /
 * `inversePink`): one sentence and an Undo, for 6 seconds, no confirm.
 */
describe('Snackbar', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('says its sentence with an Undo, on the inverse surface', () => {
    const { getByText, getByTestId } = render(
      <Snackbar testID="snack" visible message="Roxy AI is off." actionLabel="Undo" onAction={jest.fn()} onDismiss={jest.fn()} />,
    );
    expect(getByText('Roxy AI is off.')).toBeTruthy();
    expect(flat(getByTestId('snack')).backgroundColor).toBe(light.inverse);
    expect(flat(getByText('Roxy AI is off.')).color).toBe(light.onInverse);
    expect(flat(getByText('Undo')).color).toBe(light.inversePink);
  });

  it('Undo runs the action and closes the snackbar', () => {
    const onAction = jest.fn();
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <Snackbar testID="snack" visible message="Off." actionLabel="Undo" onAction={onAction} onDismiss={onDismiss} />,
    );
    fireEvent.press(getByTestId('snack-action'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves by itself after 6 seconds', () => {
    const onDismiss = jest.fn();
    render(<Snackbar visible message="Off." onDismiss={onDismiss} />);
    expect(SNACKBAR_DURATION).toBe(6000);
    act(() => { jest.advanceTimersByTime(SNACKBAR_DURATION - 1); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while hidden', () => {
    const { queryByText } = render(<Snackbar visible={false} message="Off." onDismiss={jest.fn()} />);
    expect(queryByText('Off.')).toBeNull();
  });

  it('is announced politely and its action is a real target', () => {
    const { getByTestId } = render(
      <Snackbar testID="snack" visible message="Off." actionLabel="Undo" onAction={jest.fn()} onDismiss={jest.fn()} />,
    );
    expect(getByTestId('snack').props.accessibilityLiveRegion).toBe('polite');
    expect(Number(flat(getByTestId('snack-action')).minHeight)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});
