import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { FilterChips } from '../../../components/discover/FilterChips';
import { PosterCard, RowCard } from '../../../components/discover/DiscoverCards';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

/**
 * Discover's categories were unreadable: chips rendered as 44pt slabs and card
 * titles cropped mid-word.
 *
 * Both come from applying a rule to the wrong thing. The touch-target minimum
 * belongs on what a finger HITS, not on the pill that gets painted — putting it
 * on the paint makes a 44pt block carrying a 12px word. And a one-line title in
 * a 150pt card truncates any real name: "The Rise and Fall of a Midwest
 * Princess" is 39 characters and about 25 fit.
 */

const CHIPS = [
  { key: 'all' as const, label: 'All' },
  { key: 'archive' as const, label: 'Archive' },
  { key: 'comms' as const, label: 'Communities' },
];

describe('FilterChips geometry', () => {
  it('keeps a full touch target while the pill stays visually light', () => {
    const v = render(
      <FilterChips chips={CHIPS} value="all" onChange={jest.fn()} label="Filter" emphasis="primary" testID="c" />
    );
    const target = flat(v.getByTestId('c-all'));
    const pill = flat(v.getByTestId('c-all-pill'));
    expect(Number(target.minHeight)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(Number(pill.height)).toBeLessThan(MIN_TOUCH_TARGET);
  });

  it('does not let a chip label wrap and make the row two lines tall', () => {
    const v = render(
      <FilterChips chips={CHIPS} value="all" onChange={jest.fn()} label="Filter" testID="c" />
    );
    expect(v.getByText('Communities').props.numberOfLines).toBe(1);
  });

  it('sizes a primary chip close to an inline one, not half again bigger', () => {
    // The top row read as oversized because it used bodyLg — 15px — where the
    // in-rail rows use 12px. A row that decides which rails exist should lead
    // by weight, not by being a different size of object.
    const primary = render(
      <FilterChips chips={CHIPS} value="all" onChange={jest.fn()} label="F" emphasis="primary" testID="p" />
    );
    const inline = render(
      <FilterChips chips={CHIPS} value="all" onChange={jest.fn()} label="F" testID="i" />
    );
    const p = Number(flat(primary.getByText('All')).fontSize);
    const i = Number(flat(inline.getByText('All')).fontSize);
    expect(p - i).toBeLessThanOrEqual(1);
  });
});

describe('PosterCard titles', () => {
  it('gives a long title two lines instead of cropping it', () => {
    const v = render(
      <PosterCard
        title="The Rise and Fall of a Midwest Princess"
        subtitle="2023 · Chappell Roan"
        artSeed="midwest"
        onPress={jest.fn()}
        testID="p"
      />
    );
    expect(v.getByText('The Rise and Fall of a Midwest Princess').props.numberOfLines).toBe(2);
  });

  it('reserves the same title height whatever the title, so a row stays level', () => {
    // Two lines for a long title and one for a short one makes every card in
    // the rail a different height, which is what makes a row look broken.
    const short = render(<PosterCard title="Bound" subtitle="1996" artSeed="bound" onPress={jest.fn()} testID="s" />);
    const long = render(
      <PosterCard title="She-Ra and the Princesses of Power" subtitle="2018" artSeed="shera" onPress={jest.fn()} testID="l" />
    );
    const a = flat(short.getByText('Bound'));
    const b = flat(long.getByText('She-Ra and the Princesses of Power'));
    expect(a.minHeight).toBeDefined();
    expect(a.minHeight).toBe(b.minHeight);
  });
});

describe('RowCard subtitles', () => {
  it('wraps a real subtitle instead of cropping it', () => {
    // Found by the Playwright audit, not by a unit test: Speed Dating's
    // short_description is 51 characters and the box is 168px, so a one-line
    // subtitle cut it mid-sentence. Fixing the row rather than the row's data,
    // because the next long description would break identically.
    const v = render(
      <RowCard
        icon="game-controller"
        title="Speed Dating"
        subtitle="5-minute video speed dates. Match with someone new."
        artSeed="Speed Dating"
        onPress={jest.fn()}
        testID="g"
      />
    );
    expect(
      v.getByText('5-minute video speed dates. Match with someone new.').props.numberOfLines
    ).toBe(2);
  });

  it('reserves the subtitle height so a rail of row cards stays level', () => {
    const short = render(
      <RowCard icon="game-controller" title="A" subtitle="Short" artSeed="a" onPress={jest.fn()} testID="a" />
    );
    const long = render(
      <RowCard
        icon="game-controller"
        title="B"
        subtitle="5-minute video speed dates. Match with someone new."
        artSeed="b"
        onPress={jest.fn()}
        testID="b"
      />
    );
    const a = flat(short.getByText('Short'));
    const b = flat(long.getByText('5-minute video speed dates. Match with someone new.'));
    expect(a.minHeight).toBeDefined();
    expect(a.minHeight).toBe(b.minHeight);
  });
});
