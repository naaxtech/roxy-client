import { render } from '@testing-library/react-native';
import { ScoreRing } from '../../../components/archive/ScoreRing';
import { formatScore } from '../../../lib/archive';
import { THEMES } from '../../../lib/theme';
import { ringDash } from '../../../components/archive/archiveTokens';
import { useThemeStore } from '../../../store/themeStore';

// Same reason the gradient is mocked elsewhere: react-native-svg runs `stroke`
// through processColor, so a raw-hex assertion would compare "#2FC97E" against
// {payload: 4281321854}. Host components keep the props readable.
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
}));

afterEach(() => useThemeStore.setState({ theme: 'dark' }));

describe('ScoreRing', () => {
  it('fills the arc in proportion to the score', () => {
    const v = render(<ScoreRing score={formatScore(84, 100)} testID="r" />);
    const progress = v.getByTestId('r-progress');
    const r = Number(progress.props.r);
    expect(progress.props.strokeDasharray).toEqual(ringDash(84, r));
  });

  it('paints the arc with the band colour of the ACTIVE theme', () => {
    const dark = render(<ScoreRing score={formatScore(84, 100)} testID="r" />);
    expect(dark.getByTestId('r-progress').props.stroke).toBe(THEMES.dark.success);
    dark.unmount();

    useThemeStore.setState({ theme: 'light' });
    const light = render(<ScoreRing score={formatScore(84, 100)} testID="r" />);
    expect(light.getByTestId('r-progress').props.stroke).toBe(THEMES.light.success);
  });

  it('renders the percentage and the REC caption inside the hole', () => {
    const v = render(<ScoreRing score={formatScore(84, 100)} />);
    expect(v.getByText('84%')).toBeTruthy();
    expect(v.getByText('REC')).toBeTruthy();
  });

  it('draws no arc at all when nobody has rated it', () => {
    // A coloured ring over nothing reads as a score whatever the label says.
    const v = render(<ScoreRing score={formatScore(0, 0)} testID="r" />);
    expect(v.queryByTestId('r-progress')).toBeNull();
    expect(v.getByTestId('r-track').props.stroke).toBe(THEMES.dark.line);
    expect(v.getByText('Unreviewed')).toBeTruthy();
    expect(v.queryByText('REC')).toBeNull();
  });

  it('draws the arc from the first rating', () => {
    const v = render(<ScoreRing score={formatScore(1, 1)} testID="r" />);
    expect(v.getByTestId('r-progress')).toBeTruthy();
  });

  it('announces the whole score in one phrase', () => {
    const v = render(<ScoreRing score={formatScore(0, 0)} testID="r" />);
    expect(v.getByTestId('r').props.accessibilityLabel).toBe('Unreviewed');
  });

  it('scales the geometry with the size it is given', () => {
    const small = render(<ScoreRing score={formatScore(90, 100)} size={48} testID="s" />);
    const big = render(<ScoreRing score={formatScore(90, 100)} size={96} testID="b" />);
    expect(Number(small.getByTestId('s-track').props.r))
      .toBeLessThan(Number(big.getByTestId('b-track').props.r));
    expect(small.getByTestId('s').props.width).toBe(48);
    expect(big.getByTestId('b').props.width).toBe(96);
  });

  it('draws a full circle at 100 and nothing at 0', () => {
    const full = render(<ScoreRing score={formatScore(100, 100)} testID="f" />);
    const dash = full.getByTestId('f-progress').props.strokeDasharray as number[];
    expect(dash[1]).toBeCloseTo(0, 5);
    expect(dash[0]).toBeGreaterThan(0);

    const none = render(<ScoreRing score={formatScore(0, 100)} testID="z" />);
    const zero = none.getByTestId('z-progress').props.strokeDasharray as number[];
    expect(zero[0]).toBe(0);
  });
});
