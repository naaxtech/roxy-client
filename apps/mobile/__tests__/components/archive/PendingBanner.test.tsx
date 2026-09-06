import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PendingBanner } from '../../../components/archive/PendingBanner';
import { THEMES } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { useThemeStore } from '../../../store/themeStore';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

afterEach(() => useThemeStore.setState({ theme: 'dark' }));

describe('PendingBanner', () => {
  it('carries the browse banner copy verbatim', () => {
    const v = render(<PendingBanner />);
    expect(v.getByText('Membership pending — you still get the Archive')).toBeTruthy();
    expect(
      v.getByText(
        "Browse, search, read every review and score anything you've seen. Writing reviews, adding entries and the rest of Roxy unlock when a mod approves you — usually within 24h."
      )
    ).toBeTruthy();
  });

  it('carries the locked-surface copy verbatim in its locked variant', () => {
    const v = render(<PendingBanner variant="locked" />);
    expect(
      v.getByText(
        "Your membership is still pending, so this one is read-only for now. You can keep scoring anything you've seen — that counts and stays."
      )
    ).toBeTruthy();
    // The locked variant is a line inside a sheet, not a headed banner.
    expect(v.queryByText('Membership pending — you still get the Archive')).toBeNull();
  });

  it('renders no call to action unless it is given one', () => {
    const v = render(<PendingBanner testID="b" />);
    expect(v.queryByTestId('b-action')).toBeNull();
  });

  it('renders the action it is given, at the touch-target floor', () => {
    const onActionPress = jest.fn();
    const v = render(
      <PendingBanner actionLabel="What happens next?" onActionPress={onActionPress} testID="b" />
    );
    const action = v.getByTestId('b-action');
    expect(flat(action).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(action.props.accessibilityRole).toBe('button');
    fireEvent.press(action);
    expect(onActionPress).toHaveBeenCalledTimes(1);
  });

  it('is bordered in gold, the waiting colour, in both themes', () => {
    const dark = render(<PendingBanner testID="b" />);
    expect(flat(dark.getByTestId('b')).borderColor).toBe(THEMES.dark.goldInk);
    dark.unmount();

    useThemeStore.setState({ theme: 'light' });
    const light = render(<PendingBanner testID="b" />);
    expect(flat(light.getByTestId('b')).borderColor).toBe(THEMES.light.goldInk);
  });

  it('reads as one announcement, not an hourglass followed by prose', () => {
    const v = render(<PendingBanner testID="b" />);
    const banner = v.getByTestId('b');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(banner.props.accessibilityLabel).toContain('Membership pending');
  });
});
