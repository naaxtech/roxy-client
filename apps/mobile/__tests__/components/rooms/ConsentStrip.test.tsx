import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import { ConsentStrip, CONSENT_ACTIONS } from '../../../components/rooms/ConsentStrip';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | string>;

const handlers = () => ({
  onEnd: jest.fn(),
  onReport: jest.fn(),
  onBlock: jest.fn(),
  onLeaveQuietly: jest.fn(),
});

/**
 * The consent strip is the one piece of chrome in a live video or audio session
 * that must never be missing, never be covered and never be a scroll away.
 *
 * A woman on a five-minute video date with a stranger needs the exit in the same
 * place every second of it. "It is in the overflow menu" is not an exit.
 */
describe('ConsentStrip', () => {
  it('offers all four ways out, always', () => {
    const h = handlers();
    const { getByTestId } = render(<ConsentStrip {...h} />);
    for (const action of ['end', 'report', 'block', 'leave']) {
      expect(getByTestId(`consent-${action}`)).toBeTruthy();
    }
    expect(CONSENT_ACTIONS).toHaveLength(4);
  });

  it('routes each control to its own handler', () => {
    const h = handlers();
    const { getByTestId } = render(<ConsentStrip {...h} />);

    fireEvent.press(getByTestId('consent-end'));
    expect(h.onEnd).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId('consent-report'));
    expect(h.onReport).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId('consent-block'));
    expect(h.onBlock).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId('consent-leave'));
    expect(h.onLeaveQuietly).toHaveBeenCalledTimes(1);

    // Each control does exactly one thing — no shared handler, no accidental
    // "end" firing when she meant "block".
    expect(h.onEnd).toHaveBeenCalledTimes(1);
  });

  /**
   * "Leave quietly" is a distinct promise from "End call": nobody is told. If it
   * were only a relabelled exit the label would be a lie, so the label has to
   * carry the promise where a screen reader will read it.
   */
  it('promises that leaving quietly is quiet', () => {
    const { getByTestId } = render(<ConsentStrip {...handlers()} />);
    const label = String(getByTestId('consent-leave').props.accessibilityLabel);
    expect(label).toMatch(/quiet/i);
    expect(label).toMatch(/no(body| one) is (told|notified)/i);
  });

  it('tells a screen reader that reporting is anonymous', () => {
    const { getByTestId } = render(<ConsentStrip {...handlers()} />);
    expect(String(getByTestId('consent-report').props.accessibilityLabel))
      .toMatch(/anonymous/i);
  });

  it('gives every control a real touch target, never hitSlop', () => {
    const { getByTestId } = render(<ConsentStrip {...handlers()} />);
    for (const action of ['end', 'report', 'block', 'leave']) {
      const node = getByTestId(`consent-${action}`);
      expect(Number(flat(node).minHeight)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(node.props.hitSlop).toBeUndefined();
    }
  });

  /**
   * The structural assertion. The strip pins itself rather than flowing, so no
   * parent layout can push it below the fold and no content can grow over it.
   */
  it('pins itself so it cannot be scrolled or pushed out of view', () => {
    const { getByTestId } = render(<ConsentStrip {...handlers()} />);
    const strip = flat(getByTestId('consent-strip'));
    expect(strip.position).toBe('absolute');
    expect(strip.bottom).toBeDefined();
    expect(strip.left).toBeDefined();
    expect(strip.right).toBeDefined();
  });

  it('names itself as a group so it is findable by voice control', () => {
    const { getByTestId } = render(<ConsentStrip {...handlers()} />);
    expect(String(getByTestId('consent-strip').props.accessibilityLabel))
      .toMatch(/safety/i);
  });
});
