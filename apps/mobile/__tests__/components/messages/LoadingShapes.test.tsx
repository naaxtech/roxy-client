import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { BusySwap, RowsSkeleton, ThreadSkeleton } from '../../../components/messages/LoadingShapes';

/**
 * F8: when data is not in memory, the placeholder is the content's FINAL
 * geometry (rows: 48 dp avatar + two lines; threads: alternating bubbles),
 * one progressbar for the whole thing, the screen's `-loading` testID, and
 * no spinner.
 */
describe('RowsSkeleton', () => {
  it('is one progressbar with the screen testID and label, n rows of avatar + two lines', () => {
    const v = render(<RowsSkeleton testID="inbox-direct-loading" label="Loading your messages" rows={3} />);
    const group = v.getByTestId('inbox-direct-loading');
    expect(group.props.accessibilityRole).toBe('progressbar');
    expect(group.props.accessibilityLabel).toBe('Loading your messages');
    const avatars = v.getAllByTestId('rows-skeleton-avatar', { includeHiddenElements: true });
    expect(avatars).toHaveLength(3);
    expect(StyleSheet.flatten(avatars[0].props.style)).toEqual(expect.objectContaining({ width: 48, height: 48, borderRadius: 24 }));
    expect(v.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
  });

  it('takes the avatar size of the list it stands in for', () => {
    const v = render(<RowsSkeleton testID="x-loading" rows={1} avatar={40} />);
    const [a] = v.getAllByTestId('rows-skeleton-avatar', { includeHiddenElements: true });
    expect(StyleSheet.flatten(a.props.style)).toEqual(expect.objectContaining({ width: 40, height: 40 }));
  });
});

describe('BusySwap (F11: fast actions never flash a loader; a shown O stays 400 ms)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const ui = (busy: boolean, onFill = false) => (
    <BusySwap busy={busy} onFill={onFill} label="Saving"><Text>Save</Text></BusySwap>
  );

  it('a wait under 200 ms keeps the label and never shows the O', () => {
    const v = render(ui(true));
    act(() => { jest.advanceTimersByTime(150); });
    expect(v.getByText('Save')).toBeTruthy();
    v.rerender(ui(false));
    act(() => { jest.advanceTimersByTime(1000); });
    expect(v.getByText('Save')).toBeTruthy();
    expect(v.queryByLabelText('Saving')).toBeNull();
  });

  it('a longer wait swaps the label for the O at 200 ms and keeps it at least 400 ms', () => {
    const v = render(ui(true));
    act(() => { jest.advanceTimersByTime(199); });
    expect(v.queryByLabelText('Saving')).toBeNull();
    act(() => { jest.advanceTimersByTime(1); });
    expect(v.getByLabelText('Saving')).toBeTruthy();
    expect(v.queryByText('Save')).toBeNull();
    v.rerender(ui(false));
    act(() => { jest.advanceTimersByTime(399); });
    expect(v.getByLabelText('Saving')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(1); });
    expect(v.getByText('Save')).toBeTruthy();
    expect(v.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
  });

  it('on a filled (pink) button the O sits on a surface disc so it stays visible', () => {
    const v = render(ui(true, true));
    act(() => { jest.advanceTimersByTime(200); });
    const o = v.getByLabelText('Saving');
    expect(StyleSheet.flatten(o.props.style).backgroundColor).toBeTruthy();
  });
});

describe('ThreadSkeleton', () => {
  it('alternates their bubbles (left) and hers (right), one progressbar', () => {
    const v = render(<ThreadSkeleton testID="chat-loading" label="Loading messages" />);
    expect(v.getByTestId('chat-loading').props.accessibilityRole).toBe('progressbar');
    expect(v.getByLabelText('Loading messages')).toBeTruthy();
    const rows = v.getAllByTestId(/^thread-skeleton-(theirs|mine)$/, { includeHiddenElements: true });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const sides = rows.map((r) => r.props.testID);
    expect(sides).toContain('thread-skeleton-theirs');
    expect(sides).toContain('thread-skeleton-mine');
    expect(StyleSheet.flatten(rows.find((r) => r.props.testID === 'thread-skeleton-mine')!.props.style).alignSelf).toBe('flex-end');
  });
});
