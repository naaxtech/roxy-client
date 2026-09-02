import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { MediaTypeChips } from '../../../components/archive/MediaTypeChips';
import { SortChips } from '../../../components/archive/SortChips';
import { THEMES } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { useThemeStore } from '../../../store/themeStore';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

afterEach(() => useThemeStore.setState({ theme: 'dark' }));

describe('MediaTypeChips', () => {
  it('names the types the way a person browsing would, not the way the enum does', () => {
    // The column is still film/tv/comic — only what she reads changed. "Comic"
    // excluded manga by implication, which is much of what that category holds.
    const v = render(<MediaTypeChips value={null} onChange={jest.fn()} />);
    ['Everything', 'Movies', 'Series', 'Books', 'Comics & Manga', 'Music']
      .forEach((l) => expect(v.getByText(l)).toBeTruthy());
  });

  it('shows how many entries each type has, when it is given counts', () => {
    const v = render(
      <MediaTypeChips
        value={null}
        onChange={jest.fn()}
        counts={{ film: 12, tv: 10, book: 11, comic: 6, music: 6 }}
        testID="t"
      />
    );
    // Everything carries the sum, so the row totals the catalogue at a glance.
    expect(v.getByTestId('t-all').props.accessibilityLabel).toBe('Everything, 45 entries');
    expect(v.getByTestId('t-comic').props.accessibilityLabel).toBe('Comics & Manga, 6 entries');
  });

  it('renders without counts at all when it is not given any', () => {
    const v = render(<MediaTypeChips value={null} onChange={jest.fn()} testID="t" />);
    expect(v.getByTestId('t-film').props.accessibilityLabel).toBe('Movies');
  });

  it('treats All as no filter rather than a seventh media type', () => {
    const onChange = jest.fn();
    const v = render(<MediaTypeChips value="film" onChange={onChange} />);
    fireEvent.press(v.getByTestId('archive-type-chips-all'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('passes the media type through as the enum the query wants', () => {
    const onChange = jest.fn();
    const v = render(<MediaTypeChips value={null} onChange={onChange} />);
    fireEvent.press(v.getByTestId('archive-type-chips-tv'));
    expect(onChange).toHaveBeenCalledWith('tv');
  });

  it('is a radio group whose selection a screen reader can actually read', () => {
    const v = render(<MediaTypeChips value="tv" onChange={jest.fn()} testID="t" />);
    const on = v.getByTestId('t-tv');
    const off = v.getByTestId('t-book');
    expect(on.props.accessibilityRole).toBe('radio');
    // Bare accessibilityState emits no attribute on react-native-web 0.19.
    expect(on.props['aria-checked']).toBe(true);
    expect(off.props['aria-checked']).toBe(false);
    expect(on.props.accessibilityState.checked).toBe(true);
  });

  it('fills the selected PILL with the theme primary, in both themes', () => {
    // The fill is on the pill, not on the touch target: the target is a 44pt
    // box with no paint, so a 44pt slab of primary is exactly what this row
    // must not render.
    const dark = render(<MediaTypeChips value="tv" onChange={jest.fn()} testID="t" />);
    expect(flat(dark.getByTestId('t-tv-pill')).backgroundColor).toBe(THEMES.dark.primary);
    dark.unmount();

    useThemeStore.setState({ theme: 'light' });
    const light = render(<MediaTypeChips value="tv" onChange={jest.fn()} testID="t" />);
    expect(flat(light.getByTestId('t-tv-pill')).backgroundColor).toBe(THEMES.light.primary);
  });

  it('keeps a full touch target while the pill stays visually light', () => {
    // The whole point of the redesign. The target is >= 44pt and measured; the
    // pill inside is smaller, so the row reads as chips rather than as slabs.
    const v = render(<MediaTypeChips value={null} onChange={jest.fn()} testID="t" />);
    const target = flat(v.getByTestId('t-film'));
    const pill = flat(v.getByTestId('t-film-pill'));
    expect(Number(target.minHeight)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(Number(pill.height)).toBeLessThan(MIN_TOUCH_TARGET);
  });

  it('dims a type with nothing in it rather than hiding it', () => {
    // Hiding an empty category makes the row jump around as the catalogue
    // grows; dimming says "nothing here yet" without moving anything.
    const v = render(
      <MediaTypeChips
        value={null}
        onChange={jest.fn()}
        counts={{ film: 12, tv: 0, book: 11, comic: 6, music: 6 }}
        testID="t"
      />
    );
    expect(Number(flat(v.getByTestId('t-tv')).opacity)).toBeLessThan(1);
    expect(flat(v.getByTestId('t-film')).opacity).toBeUndefined();
  });

  it('sizes every chip to the touch-target floor', () => {
    const v = render(<MediaTypeChips value={null} onChange={jest.fn()} testID="t" />);
    ['all', 'film', 'tv', 'book', 'comic', 'music'].forEach((k) => {
      const chip = v.getByTestId(`t-${k}`);
      expect(flat(chip).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(chip.props.hitSlop).toBeUndefined();
    });
  });
});

describe('SortChips', () => {
  it('offers the prototype three under a SORT label', () => {
    const v = render(<SortChips value="top" onChange={jest.fn()} />);
    expect(v.getByText('SORT')).toBeTruthy();
    ['Top rated', 'Most voted', 'Newest'].forEach((l) => expect(v.getByText(l)).toBeTruthy());
  });

  it('maps each label onto the sort key the query takes', () => {
    const onChange = jest.fn();
    const v = render(<SortChips value="top" onChange={onChange} />);
    fireEvent.press(v.getByText('Most voted'));
    expect(onChange).toHaveBeenCalledWith('voted');
    fireEvent.press(v.getByText('Newest'));
    expect(onChange).toHaveBeenCalledWith('newest');
  });

  it('tints the selected chip rather than filling it, so it never outranks the type row', () => {
    const v = render(<SortChips value="voted" onChange={jest.fn()} testID="s" />);
    const on = flat(v.getByTestId('s-voted'));
    expect(on.backgroundColor).not.toBe(THEMES.dark.primary);
    expect(String(on.backgroundColor)).toContain('rgba');
  });

  it('announces its selection', () => {
    const v = render(<SortChips value="newest" onChange={jest.fn()} testID="s" />);
    expect(v.getByTestId('s-newest').props['aria-checked']).toBe(true);
    expect(v.getByTestId('s-top').props['aria-checked']).toBe(false);
    expect(v.getByTestId('s').props.accessibilityRole).toBe('radiogroup');
  });

  it('sizes every chip to the touch-target floor', () => {
    const v = render(<SortChips value="top" onChange={jest.fn()} testID="s" />);
    ['top', 'voted', 'newest'].forEach((k) => {
      expect(flat(v.getByTestId(`s-${k}`)).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    });
  });
});
