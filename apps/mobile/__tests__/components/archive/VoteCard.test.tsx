import { render, fireEvent } from '@testing-library/react-native';
import { Text, StyleSheet } from 'react-native';
import { VoteCard } from '../../../components/archive/VoteCard';
import { SCORE_GRADIENT } from '../../../components/archive/archiveTokens';
import { THEMES } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { useThemeStore } from '../../../store/themeStore';

// House convention: host component so `colors` stays the raw array rather than
// processColor's integers.
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

afterEach(() => useThemeStore.setState({ theme: 'dark' }));

describe('VoteCard', () => {
  it('asks the one question the Archive scores', () => {
    const v = render(<VoteCard myVote={null} onUp={jest.fn()} onDown={jest.fn()} />);
    expect(v.getByText('Seen it? Would you recommend it to another wlw?')).toBeTruthy();
  });

  it('calls back on each answer', () => {
    const onUp = jest.fn();
    const onDown = jest.fn();
    const v = render(<VoteCard myVote={null} onUp={onUp} onDown={onDown} testID="v" />);
    fireEvent.press(v.getByTestId('v-up'));
    expect(onUp).toHaveBeenCalledTimes(1);
    fireEvent.press(v.getByTestId('v-down'));
    expect(onDown).toHaveBeenCalledTimes(1);
  });

  it('marks her answer with a tick as well as a colour', () => {
    // Colour alone is not an indicator (SC 1.4.1), and on a two-button row the
    // unselected button is still coloured.
    const v = render(<VoteCard myVote="up" onUp={jest.fn()} onDown={jest.fn()} testID="v" />);
    expect(v.getByText('👍 Yes ✓')).toBeTruthy();
    expect(v.getByText('👎 No')).toBeTruthy();
  });

  it('paints the chosen answer with its band gradient', () => {
    const up = render(<VoteCard myVote="up" onUp={jest.fn()} onDown={jest.fn()} testID="v" />);
    expect(up.getByTestId('v-up').props.colors).toEqual(SCORE_GRADIENT.good);
    up.unmount();

    const down = render(<VoteCard myVote="down" onUp={jest.fn()} onDown={jest.fn()} testID="v" />);
    expect(down.getByTestId('v-down').props.colors).toEqual(SCORE_GRADIENT.poor);
  });

  it('leaves both answers on a plain surface until she picks one', () => {
    const v = render(<VoteCard myVote={null} onUp={jest.fn()} onDown={jest.fn()} testID="v" />);
    expect(flat(v.getByTestId('v-up')).backgroundColor).toBe(THEMES.dark.surfaceLight);
    expect(flat(v.getByTestId('v-down')).backgroundColor).toBe(THEMES.dark.surfaceLight);
  });

  it('resolves in the light theme', () => {
    useThemeStore.setState({ theme: 'light' });
    const v = render(<VoteCard myVote={null} onUp={jest.fn()} onDown={jest.fn()} testID="v" />);
    expect(flat(v.getByTestId('v')).backgroundColor).toBe(THEMES.light.surface);
  });

  it('announces which answer is hers without relying on the emoji', () => {
    const v = render(<VoteCard myVote="up" onUp={jest.fn()} onDown={jest.fn()} testID="v" />);
    const up = v.getByTestId('v-up');
    expect(up.props.accessibilityRole).toBe('button');
    expect(up.props.accessibilityLabel).toBe('Yes, I would recommend it to another wlw');
    expect(up.props['aria-selected']).toBe(true);
    expect(v.getByTestId('v-down').props['aria-selected']).toBe(false);
  });

  it('sizes both answers to the touch-target floor', () => {
    const v = render(<VoteCard myVote={null} onUp={jest.fn()} onDown={jest.fn()} testID="v" />);
    expect(flat(v.getByTestId('v-up')).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(flat(v.getByTestId('v-down')).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it('shows the note under the buttons when it is given one, and nothing when not', () => {
    const withNote = render(
      <VoteCard myVote={null} onUp={jest.fn()} onDown={jest.fn()} note="Scoring works while pending." />
    );
    expect(withNote.getByText('Scoring works while pending.')).toBeTruthy();

    const without = render(<VoteCard myVote={null} onUp={jest.fn()} onDown={jest.fn()} testID="v" />);
    expect(without.queryByTestId('v-note')).toBeNull();
  });

  it('hosts the row of secondary actions the entry screen puts in this card', () => {
    const v = render(
      <VoteCard myVote={null} onUp={jest.fn()} onDown={jest.fn()} footer={<Text>+ Watchlist</Text>} />
    );
    expect(v.getByText('+ Watchlist')).toBeTruthy();
  });
});
