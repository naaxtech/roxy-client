import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ScorePill } from '../../../components/archive/ScorePill';
import { formatScore } from '../../../lib/archive';
import { THEMES } from '../../../lib/theme';
import { SCORE_GRADIENT } from '../../../components/archive/archiveTokens';
import { useThemeStore } from '../../../store/themeStore';

// House convention (see QuestionOfTheDayCard.contrast.test): render the
// gradient as a host component so `colors` survives as the raw array. The real
// component runs it through processColor, which turns #178A4C into 4279732812
// and makes an assertion about brand ramps unreadable.
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

afterEach(() => useThemeStore.setState({ theme: 'dark' }));

describe('ScorePill', () => {
  it('shows the percentage and the flower for a well-liked entry', () => {
    const v = render(<ScorePill score={formatScore(84, 100)} />);
    expect(v.getByText('84%')).toBeTruthy();
    expect(v.getByText('✿')).toBeTruthy();
  });

  it('carries the mixed glyph at the divisive band and the wilted one below it', () => {
    expect(render(<ScorePill score={formatScore(60, 100)} />).getByText('❋')).toBeTruthy();
    expect(render(<ScorePill score={formatScore(20, 100)} />).getByText('🥀')).toBeTruthy();
  });

  it('says Unreviewed when nobody has rated it, with no icon and no number', () => {
    const v = render(<ScorePill score={formatScore(0, 0)} />);
    expect(v.getByText('Unreviewed')).toBeTruthy();
    expect(v.queryByText('0%')).toBeNull();
    // No flower either: an icon here is a verdict nothing supports.
    expect(v.queryByText('✿')).toBeNull();
  });

  it('shows the rating from the very first vote', () => {
    const v = render(<ScorePill score={formatScore(1, 1)} />);
    expect(v.getByText('100%')).toBeTruthy();
  });

  it('paints the band gradient, not the brand ramp', () => {
    const v = render(<ScorePill score={formatScore(84, 100)} testID="p" />);
    expect(v.getByTestId('p').props.colors).toEqual(SCORE_GRADIENT.good);
  });

  it('drops to a neutral theme surface when unreviewed, in both themes', () => {
    const dark = render(<ScorePill score={formatScore(0, 0)} testID="p" />);
    expect(flat(dark.getByTestId('p')).backgroundColor).toBe(THEMES.dark.surfaceLight);
    dark.unmount();

    useThemeStore.setState({ theme: 'light' });
    const light = render(<ScorePill score={formatScore(0, 0)} testID="p" />);
    expect(flat(light.getByTestId('p')).backgroundColor).toBe(THEMES.light.surfaceLight);
  });

  it('announces itself as a sentence rather than a flower glyph', () => {
    const v = render(<ScorePill score={formatScore(84, 100)} testID="p" />);
    expect(v.getByTestId('p').props.accessibilityLabel).toBe('84% of 100 members recommend it');
    const fresh = render(<ScorePill score={formatScore(0, 0)} testID="q" />);
    expect(fresh.getByTestId('q').props.accessibilityLabel).toBe('Not reviewed yet');
  });
});
