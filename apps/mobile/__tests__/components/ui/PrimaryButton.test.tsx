import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

const mockReducedMotion = jest.fn(() => false);
jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion(),
}));

import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { THEMES, LIP } from '../../../lib/theme';
import { PRESS, SPRING } from '../../../lib/motion';
import { TYPE } from '../../../lib/typography';
import { useThemeStore } from '../../../store/themeStore';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

function translateYOf(node: { props: { style?: unknown } }): number {
  const transform = (flat(node).transform ?? []) as Record<string, unknown>[];
  return transform.reduce((acc, t) => (typeof t.translateY === 'number' ? acc + t.translateY : acc), 0);
}

beforeEach(() => {
  mockReducedMotion.mockReturnValue(false);
  useThemeStore.setState({ theme: 'light' });
});

/**
 * Design direction v2 › Motion › Press states: the ONE primary button per
 * screen is a `pink` face on a 3 dp `pinkLip`; press-in drops the face onto
 * the lip (fastSpatial). Disabled: `raised` face, `ink3` label, no lip.
 */
describe('PrimaryButton — the Duolingo lip', () => {
  it('is a button with its label, testID and press handler', () => {
    const onPress = jest.fn();
    const v = render(<PrimaryButton testID="go" label="Continue" onPress={onPress} />);
    const btn = v.getByTestId('go');
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityLabel).toBe('Continue');
    expect(v.getByText('Continue')).toBeTruthy();
    fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('paints a pink face with a white label in light, on a 3 dp pinkLip', () => {
    const v = render(<PrimaryButton testID="go" label="Continue" onPress={() => {}} />);
    const face = v.getByTestId('go-face');
    const lip = v.getByTestId('go-lip');
    expect(flat(face).backgroundColor).toBe(THEMES.light.pink);
    expect(flat(v.getByText('Continue')).color).toBe(THEMES.light.onPink);
    expect(flat(lip).backgroundColor).toBe(THEMES.light.pinkLip);
    expect(LIP).toBe(3);
    expect(flat(lip).top).toBe(LIP);
    expect(flat(face).height).toBe(52);
    expect(flat(face).borderRadius).toBe(flat(lip).borderRadius);
  });

  it('uses the dark roles in dark: pink #F22481 with the dark onPink label, lip #A5145A', () => {
    useThemeStore.setState({ theme: 'dark' });
    const v = render(<PrimaryButton testID="go" label="Continue" onPress={() => {}} />);
    expect(flat(v.getByTestId('go-face')).backgroundColor).toBe(THEMES.dark.pink);
    expect(flat(v.getByText('Continue')).color).toBe(THEMES.dark.onPink);
    expect(flat(v.getByTestId('go-lip')).backgroundColor).toBe(THEMES.dark.pinkLip);
  });

  it('sets the label in the v2 button type (Commissioner 600, 16/20)', () => {
    const v = render(<PrimaryButton testID="go" label="Continue" onPress={() => {}} />);
    const label = flat(v.getByText('Continue'));
    expect(label.fontFamily).toBe(TYPE.button.fontFamily);
    expect(label.fontSize).toBe(16);
  });

  it('drops the face 3 dp onto the lip on press-in, on fastSpatial', () => {
    const spring = jest.spyOn(Animated, 'spring');
    const v = render(<PrimaryButton testID="go" label="Continue" onPress={() => {}} />);
    fireEvent(v.getByTestId('go'), 'pressIn', { nativeEvent: {} });
    const call = spring.mock.calls.find(([, cfg]) => cfg.toValue === PRESS.lipDrop);
    expect(call?.[1]).toMatchObject({ stiffness: SPRING.fastSpatial.stiffness, damping: SPRING.fastSpatial.damping });
    spring.mockRestore();
  });

  it('jumps the face down and back under Reduce Motion', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<PrimaryButton testID="go" label="Continue" onPress={() => {}} />);
    expect(translateYOf(v.getByTestId('go-face'))).toBe(0);
    fireEvent(v.getByTestId('go'), 'pressIn', { nativeEvent: {} });
    expect(translateYOf(v.getByTestId('go-face'))).toBe(LIP);
    fireEvent(v.getByTestId('go'), 'pressOut', { nativeEvent: {} });
    expect(translateYOf(v.getByTestId('go-face'))).toBe(0);
  });

  it('when disabled: raised face, ink3 label, no lip, no press', () => {
    const onPress = jest.fn();
    const v = render(<PrimaryButton testID="go" label="Continue" onPress={onPress} disabled />);
    expect(flat(v.getByTestId('go-face')).backgroundColor).toBe(THEMES.light.raised);
    expect(flat(v.getByText('Continue')).color).toBe(THEMES.light.ink3);
    expect(v.queryByTestId('go-lip')).toBeNull();
    expect(v.getByTestId('go').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(v.getByTestId('go'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('when busy: shows a progress indicator instead of the label, announces busy, and cannot be pressed', () => {
    const onPress = jest.fn();
    const v = render(<PrimaryButton testID="go" label="Continue" onPress={onPress} busy />);
    expect(v.queryByText('Continue')).toBeNull();
    expect(v.getByTestId('go-busy')).toBeTruthy();
    expect(v.getByTestId('go').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    fireEvent.press(v.getByTestId('go'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keeps a caller accessibilityLabel (e2e and screen readers depend on it)', () => {
    const v = render(
      <PrimaryButton testID="auth-submit-btn" label="Sign In" accessibilityLabel="Sign In" onPress={() => {}} />,
    );
    expect(v.getByTestId('auth-submit-btn').props.accessibilityLabel).toBe('Sign In');
  });

  it('gives a 48 dp+ touch target (52 face + 3 lip)', () => {
    const v = render(<PrimaryButton testID="go" label="Continue" onPress={() => {}} />);
    expect(flat(v.getByTestId('go')).minHeight).toBe(52 + LIP);
  });
});
