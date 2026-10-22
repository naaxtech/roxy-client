/**
 * SnackbarHost (Wave 3 lane C0; polish/motion-spec.md §3.1 row 13, F10).
 * One host mounted once at the root + an imperative API, so an optimistic
 * failure anywhere says one sentence with Retry. It renders the existing
 * `components/ui/Snackbar` (unchanged): one at a time, a new one replaces the
 * current one, 4 s alone / 6 s with an action.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

import {
  SnackbarHost,
  SNACKBAR_SHORT_MS,
  SNACKBAR_HOST_BOTTOM,
  snackbar,
} from '../../../components/feedback/SnackbarHost';
import { SNACKBAR_DURATION } from '../../../components/ui/Snackbar';
import { FAB_LANE, NAV_HEIGHT } from '../../../components/nav/navTokens';

const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  act(() => { snackbar.dismiss(); });
  jest.useRealTimers();
});

describe('SnackbarHost', () => {
  it('renders nothing until something is shown', () => {
    const v = render(<SnackbarHost />);
    expect(v.queryByTestId('snackbar')).toBeNull();
  });

  it('show() puts one polite alert on screen, above the nav bar and the FAB lane', () => {
    const v = render(<SnackbarHost />);
    act(() => { snackbar.show({ message: 'Could not save. Try again.' }); });
    const bar = v.getByTestId('snackbar');
    expect(bar.props.accessibilityRole).toBe('alert');
    expect(bar.props.accessibilityLiveRegion).toBe('polite');
    expect(v.getByText('Could not save. Try again.')).toBeTruthy();
    expect(SNACKBAR_HOST_BOTTOM).toBeGreaterThanOrEqual(NAV_HEIGHT + FAB_LANE);
  });

  it('leaves by itself after 4 s without an action', () => {
    const v = render(<SnackbarHost />);
    act(() => { snackbar.show({ message: 'Saved' }); });
    advance(SNACKBAR_SHORT_MS - 1);
    expect(v.queryByTestId('snackbar')).not.toBeNull();
    advance(1);
    expect(v.queryByTestId('snackbar')).toBeNull();
  });

  it('stays 6 s with an action; the action runs once and the bar leaves', () => {
    const onRetry = jest.fn();
    const v = render(<SnackbarHost />);
    act(() => { snackbar.show({ message: 'Not sent.', actionLabel: 'Retry', onAction: onRetry }); });
    advance(SNACKBAR_DURATION - 1);
    expect(v.getByTestId('snackbar')).toBeTruthy();
    fireEvent.press(v.getByTestId('snackbar-action'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(v.queryByTestId('snackbar')).toBeNull();
  });

  it('one at a time: a new snackbar replaces the current one', () => {
    const v = render(<SnackbarHost />);
    act(() => { snackbar.show({ message: 'First' }); });
    act(() => { snackbar.show({ message: 'Second' }); });
    expect(v.queryByText('First')).toBeNull();
    expect(v.getByText('Second')).toBeTruthy();
    // The replacement gets its own full time.
    advance(SNACKBAR_SHORT_MS - 1);
    expect(v.getByText('Second')).toBeTruthy();
  });

  it('a repeat of the same message still gets its full time (a fresh snackbar, not a stale timer)', () => {
    const v = render(<SnackbarHost />);
    act(() => { snackbar.show({ message: 'Not sent.' }); });
    advance(3000);
    act(() => { snackbar.show({ message: 'Not sent.' }); });
    advance(SNACKBAR_SHORT_MS - 1);
    expect(v.getByText('Not sent.')).toBeTruthy();
    advance(1);
    expect(v.queryByText('Not sent.')).toBeNull();
  });

  it('dismiss(id) only clears that snackbar; dismiss() clears whatever is up', () => {
    const v = render(<SnackbarHost />);
    let first = 0;
    act(() => { first = snackbar.show({ message: 'First' }); });
    act(() => { snackbar.show({ message: 'Second' }); });
    act(() => { snackbar.dismiss(first); });
    expect(v.getByText('Second')).toBeTruthy();
    act(() => { snackbar.dismiss(); });
    expect(v.queryByText('Second')).toBeNull();
  });

  it('honours a per-call duration', () => {
    const v = render(<SnackbarHost />);
    act(() => { snackbar.show({ message: 'Quick', duration: 1000 }); });
    advance(1000);
    expect(v.queryByTestId('snackbar')).toBeNull();
  });

  it('show() before the host mounts still appears once it mounts', () => {
    act(() => { snackbar.show({ message: 'Early' }); });
    const v = render(<SnackbarHost />);
    expect(v.getByText('Early')).toBeTruthy();
  });
});
