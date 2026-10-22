import { render } from '@testing-library/react-native';
import { NavIcon } from '../../../components/nav/NavIcons';

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
}));

describe('NavIcon', () => {
  // v2 bans the flower anywhere (direction › Bans; board v2-04 draws Feed as
  // a house). Was: the prototype's five-petal rosette (six Circles).
  it('draws Feed as a house in one stroked outline, with no petals', () => {
    const { UNSAFE_queryAllByType, UNSAFE_getByType } = render(<NavIcon name="feed" color="#F22481" />);
    expect(UNSAFE_queryAllByType('Circle' as never)).toHaveLength(0);
    const house = UNSAFE_getByType('Path' as never);
    expect(house.props.d).toBe('M4 10.4 12 4l8 6.4V20h-5.4v-5.8H9.4V20H4Z');
    expect(house.props.stroke).toBe('#F22481');
  });

  it('draws Discover as the search glass from the prototype', () => {
    const { UNSAFE_getByType } = render(<NavIcon name="discover" color="#9C89C2" />);
    expect(UNSAFE_getByType('Path' as never).props.d).toBe('M16.6 16.6 21 21');
  });

  it('draws Messages as the tailed bubble from the prototype', () => {
    const { UNSAFE_getByType } = render(<NavIcon name="messages" color="#9C89C2" />);
    expect(UNSAFE_getByType('Path' as never).props.d).toBe('M4 5.6h16v10.8h-8.2L7 20.4v-4H4Z');
  });

  it('draws You as the person mark from the prototype', () => {
    const { UNSAFE_getByType } = render(<NavIcon name="you" color="#9C89C2" />);
    expect(UNSAFE_getByType('Path' as never).props.d).toBe(
      'M4.8 20c1.4-3.3 4-4.9 7.2-4.9s5.8 1.6 7.2 4.9',
    );
  });
});
