import { render } from '@testing-library/react-native';
import { NavIcon } from '../../../components/nav/NavIcons';

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
}));

describe('NavIcon', () => {
  it('draws the Claude Design Feed rosette — five petals and a filled centre', () => {
    const { UNSAFE_getAllByType } = render(<NavIcon name="feed" color="#F22481" />);
    const circles = UNSAFE_getAllByType('Circle' as never);
    expect(circles).toHaveLength(6);
    expect(circles[5].props.fill).toBe('#F22481');
    expect(circles[5].props.cx).toBe('12');
    expect(circles[5].props.cy).toBe('11.6');
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
