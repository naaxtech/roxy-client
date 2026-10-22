import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('../../../lib/haptics', () => ({ haptic: jest.fn() }));

import { FilterChips } from '../../../components/discover/FilterChips';
import { PressableScale } from '../../../components/ui/PressableScale';
import { PRESS } from '../../../lib/motion';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

/**
 * Wave 3 C0 handover: "Discover chips `FilterChips` (raw Pressable, no press
 * state; lane B)". A finger on a chip showed nothing until the filter changed.
 * The chip is now a PressableScale target (still 48 dp, still a radio) and the
 * PILL — not the transparent target around it — takes the press: the shared
 * scale and a state layer clipped to its own shape.
 */
const CHIPS = [{ key: 'all', label: 'All' }, { key: 'events', label: 'Events' }] as const;
const flat = (n: { props: { style?: unknown } }) => StyleSheet.flatten(n.props.style as never) as Record<string, unknown>;

describe('FilterChips press state', () => {
  it('is a PressableScale whose target stays a 48 dp radio', () => {
    const v = render(<FilterChips chips={CHIPS} value="all" onChange={jest.fn()} label="Filter" testID="c" />);
    expect(v.UNSAFE_getAllByType(PressableScale)).toHaveLength(CHIPS.length);
    const target = v.getByTestId('c-events');
    expect(target.props.accessibilityRole).toBe('radio');
    expect(flat(target).minHeight).toBe(MIN_TOUCH_TARGET);
  });

  it('shows the press on the pill while the finger is down, and lets go after', () => {
    const v = render(<FilterChips chips={CHIPS} value="all" onChange={jest.fn()} label="Filter" testID="c" />);
    // PressableScale hands its pressed state to a function child (C0 owns the
    // plumbing and its tests); what this file adds is the pill's answer to it.
    const child = v.UNSAFE_getAllByType(PressableScale)[1].props.children as (s: { pressed: boolean }) => React.ReactElement;

    const down = render(child({ pressed: true }));
    expect(flat(down.getByTestId('c-events-press')).opacity).toBeGreaterThan(0);
    expect(flat(down.getByTestId('c-events-pill')).transform).toEqual([{ scale: PRESS.scale }]);

    const up = render(child({ pressed: false }));
    expect(up.queryByTestId('c-events-press')).toBeNull();
    expect(flat(up.getByTestId('c-events-pill')).transform).toBeUndefined();
  });

  it('still selects on press', () => {
    const onChange = jest.fn();
    const v = render(<FilterChips chips={CHIPS} value="all" onChange={onChange} label="Filter" testID="c" />);
    fireEvent.press(v.UNSAFE_getAllByType(PressableScale)[1]);
    expect(onChange).toHaveBeenCalledWith('events');
  });
});
