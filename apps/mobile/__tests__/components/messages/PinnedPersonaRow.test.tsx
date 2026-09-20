import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import { PinnedPersonaRow } from '../../../components/messages/PinnedPersonaRow';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | string>;

/**
 * Roxy and Sister do very different jobs — one hypes you up about a date, the
 * other holds the days that are not going well — and they sit next to each
 * other in the inbox. Confusing them is not a cosmetic bug.
 *
 * So the assertions below are about telling them apart WITHOUT colour, and
 * about Sister never acquiring a score.
 */
describe('the two pinned personas', () => {
  it('names its purpose in the accessibility label, not just on screen', () => {
    const roxy = render(<PinnedPersonaRow persona="roxy" onPress={jest.fn()} />);
    const sister = render(<PinnedPersonaRow persona="sister" onPress={jest.fn()} />);

    const roxyLabel = String(roxy.getByTestId('persona-row-roxy').props.accessibilityLabel);
    const sisterLabel = String(sister.getByTestId('persona-row-sister').props.accessibilityLabel);

    expect(roxyLabel).toMatch(/wingwoman/i);
    expect(sisterLabel).toMatch(/private/i);
    expect(roxyLabel).not.toBe(sisterLabel);
  });

  it('never calls Roxy an AI, an assistant or a chatbot', () => {
    const { getByTestId } = render(<PinnedPersonaRow persona="roxy" onPress={jest.fn()} />);
    const label = String(getByTestId('persona-row-roxy').props.accessibilityLabel);
    expect(label).not.toMatch(/\b(AI|assistant|chatbot|bot)\b/i);
  });

  it('gives them different shapes — a gradient ring is not a plain plate', () => {
    const roxy = render(<PinnedPersonaRow persona="roxy" onPress={jest.fn()} />);
    const sister = render(<PinnedPersonaRow persona="sister" onPress={jest.fn()} />);

    expect(roxy.queryByTestId('persona-roxy-ring')).not.toBeNull();
    expect(roxy.queryByTestId('persona-sister-plate')).toBeNull();
    expect(sister.queryByTestId('persona-sister-plate')).not.toBeNull();
    expect(sister.queryByTestId('persona-roxy-ring')).toBeNull();
  });

  it('gives them different type weight, so the difference survives greyscale', () => {
    const roxy = render(<PinnedPersonaRow persona="roxy" onPress={jest.fn()} />);
    const sister = render(<PinnedPersonaRow persona="sister" onPress={jest.fn()} />);

    const roxyName = flat(roxy.getByTestId('persona-name-roxy'));
    const sisterName = flat(sister.getByTestId('persona-name-sister'));

    expect(roxyName.fontSize).not.toBe(sisterName.fontSize);
  });

  /**
   * The load-bearing one. A vent space with a streak on it stops being a vent
   * space — she starts performing for the counter. The component has no prop
   * that could put a number there, and this asserts none appears.
   */
  it('puts no gamification anywhere near Sister', () => {
    const { queryByText, getByTestId } = render(
      <PinnedPersonaRow persona="sister" onPress={jest.fn()} />
    );
    for (const forbidden of [/streak/i, /\bXP\b/i, /points/i, /badge/i, /level/i, /\d+\s*day/i]) {
      expect(queryByText(forbidden)).toBeNull();
    }
    const label = String(getByTestId('persona-row-sister').props.accessibilityLabel);
    expect(label).toMatch(/nothing here is shared, scored or saved/i);
  });

  it('opens on press', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<PinnedPersonaRow persona="roxy" onPress={onPress} />);
    fireEvent.press(getByTestId('persona-row-roxy'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('gives both rows a real touch target rather than hitSlop', () => {
    for (const persona of ['roxy', 'sister'] as const) {
      const { getByTestId } = render(<PinnedPersonaRow persona={persona} onPress={jest.fn()} />);
      const row = getByTestId(`persona-row-${persona}`);
      expect(Number(flat(row).minHeight)).toBeGreaterThanOrEqual(48);
      expect(row.props.hitSlop).toBeUndefined();
    }
  });
});
