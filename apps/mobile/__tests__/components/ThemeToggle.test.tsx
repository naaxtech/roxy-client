import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { useThemeStore } from '../../store/themeStore';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | string>;

beforeEach(() => {
  useThemeStore.setState({ theme: 'dark' });
});

/**
 * "Appearance dark/light must actually switch" is a line in the redesign brief
 * because it half-worked: the settings screen only ever *read* the theme, and
 * the toggle was a sliding sun/moon track whose direction was ambiguous.
 */
describe('ThemeToggle', () => {
  it('offers two named choices rather than an ambiguous slider', () => {
    const { getByText } = render(<ThemeToggle />);
    expect(getByText('Dark')).toBeTruthy();
    expect(getByText('Light')).toBeTruthy();
  });

  it('marks the current theme as selected for a screen reader', () => {
    const { getByTestId } = render(<ThemeToggle />);
    expect(getByTestId('theme-dark').props.accessibilityState).toMatchObject({ selected: true });
    expect(getByTestId('theme-light').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('actually switches the theme — the whole point', async () => {
    const { getByTestId } = render(<ThemeToggle />);
    fireEvent.press(getByTestId('theme-light'));
    await waitFor(() => expect(useThemeStore.getState().theme).toBe('light'));
  });

  it('switches back', async () => {
    useThemeStore.setState({ theme: 'light' });
    const { getByTestId } = render(<ThemeToggle />);
    fireEvent.press(getByTestId('theme-dark'));
    await waitFor(() => expect(useThemeStore.getState().theme).toBe('dark'));
  });

  it('re-selecting the current theme is a no-op, not a flicker', async () => {
    const { getByTestId } = render(<ThemeToggle />);
    fireEvent.press(getByTestId('theme-dark'));
    await waitFor(() => expect(useThemeStore.getState().theme).toBe('dark'));
  });

  it('measures a real touch target instead of padding one with hitSlop', () => {
    const { getByTestId } = render(<ThemeToggle />);
    for (const key of ['theme-dark', 'theme-light']) {
      const node = getByTestId(key);
      expect(Number(flat(node).minHeight)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(node.props.hitSlop).toBeUndefined();
    }
  });
});
