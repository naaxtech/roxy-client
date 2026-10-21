import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import { PinnedPersonaRow } from '../../../components/messages/PinnedPersonaRow';
import { THEMES } from '../../../lib/theme';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | string>;

/**
 * Roxy AI and Sister do very different jobs — Roxy AI is the emotional
 * companion, Sister holds the days that are not going well — and they sit next
 * to each other at the top of Messages (v2 board v2-06). Confusing them is not
 * a cosmetic bug.
 *
 * So the assertions below are about telling them apart WITHOUT colour, and
 * about Sister never acquiring a score.
 */
describe('the two pinned rows', () => {
  it('names its purpose in the accessibility label, not just on screen', () => {
    const roxy = render(<PinnedPersonaRow persona="roxy" onPress={jest.fn()} />);
    const sister = render(<PinnedPersonaRow persona="sister" onPress={jest.fn()} />);

    const roxyLabel = String(roxy.getByTestId('persona-row-roxy').props.accessibilityLabel);
    const sisterLabel = String(sister.getByTestId('persona-row-sister').props.accessibilityLabel);

    expect(roxyLabel).toMatch(/Roxy AI/);
    expect(roxyLabel).toMatch(/companion/i);
    expect(sisterLabel).toMatch(/private/i);
    expect(roxyLabel).not.toBe(sisterLabel);
  });

  /**
   * Since 2026-10-21 (Nicole) her name is "Roxy AI" and the copy may say so.
   * The banned words stay banned: she is never an assistant, a chatbot, "ask
   * me anything" or "always on".
   */
  it('calls her Roxy AI and never an assistant, a chatbot or "always on"', () => {
    const { getByTestId, getByText } = render(<PinnedPersonaRow persona="roxy" onPress={jest.fn()} />);
    expect(getByText('Roxy AI')).toBeTruthy();
    const label = String(getByTestId('persona-row-roxy').props.accessibilityLabel);
    expect(label).not.toMatch(/assistant|chatbot|\bbot\b|ask me anything|always on|wingwoman/i);
    expect(getByText('Only you see this chat.')).toBeTruthy();
  });

  it('gives them different marks — her pink circle is not Sister’s quiet plate', () => {
    const roxy = render(<PinnedPersonaRow persona="roxy" onPress={jest.fn()} />);
    const sister = render(<PinnedPersonaRow persona="sister" onPress={jest.fn()} />);

    expect(roxy.queryByTestId('persona-roxy-ring')).not.toBeNull();
    expect(roxy.queryByTestId('persona-sister-plate')).toBeNull();
    expect(sister.queryByTestId('persona-sister-plate')).not.toBeNull();
    expect(sister.queryByTestId('persona-roxy-ring')).toBeNull();
    expect(flat(roxy.getByTestId('persona-roxy-ring')).backgroundColor).toBe(THEMES.light.pink);
    expect(flat(sister.getByTestId('persona-sister-plate')).backgroundColor).toBe(THEMES.light.sister);
  });

  it('tells them apart in greyscale: her initial and line vs Sister’s plain disc and line', () => {
    const roxy = render(<PinnedPersonaRow persona="roxy" onPress={jest.fn()} />);
    const sister = render(<PinnedPersonaRow persona="sister" onPress={jest.fn()} />);
    // Her mark carries a letter; Sister's disc carries nothing.
    expect(roxy.getByTestId('persona-roxy-initial').props.children).toBe('R');
    expect(sister.queryByTestId('persona-roxy-initial')).toBeNull();
    expect(sister.getByText('Just for you. Nothing leaves here.')).toBeTruthy();
  });

  it('wears no caps pill and no emoji in its chrome', () => {
    for (const persona of ['roxy', 'sister'] as const) {
      const view = render(<PinnedPersonaRow persona={persona} onPress={jest.fn()} />);
      expect(view.queryByText(/^[A-Z ]{4,}$/)).toBeNull();
      expect(view.queryByText(/\p{Extended_Pictographic}/u)).toBeNull();
    }
  });

  /**
   * The load-bearing one. A vent space with a streak on it stops being a vent
   * space — she starts performing for the counter. The component has no prop
   * that could put a number there, and this asserts none appears.
   */
  it('puts no gamification anywhere near Sister', () => {
    const { queryByText, getByTestId, queryByTestId } = render(
      <PinnedPersonaRow persona="sister" onPress={jest.fn()} unread />
    );
    for (const forbidden of [/streak/i, /\bXP\b/i, /points/i, /badge/i, /level/i, /\d+\s*day/i]) {
      expect(queryByText(forbidden)).toBeNull();
    }
    const label = String(getByTestId('persona-row-sister').props.accessibilityLabel);
    expect(label).toMatch(/nothing here is shared, scored or saved/i);
    // Not even an unread dot: Sister never asks for attention.
    expect(queryByTestId('persona-unread-sister')).toBeNull();
  });

  it('shows her unread dot only when she has written', () => {
    const quiet = render(<PinnedPersonaRow persona="roxy" onPress={jest.fn()} />);
    expect(quiet.queryByTestId('persona-unread-roxy')).toBeNull();
    const unread = render(<PinnedPersonaRow persona="roxy" onPress={jest.fn()} unread />);
    expect(flat(unread.getByTestId('persona-unread-roxy')).backgroundColor).toBe(THEMES.light.pink);
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
