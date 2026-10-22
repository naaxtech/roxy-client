import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import { byTheme } from '../../../components/discover/byTheme';
import { Rail } from '../../../components/discover/Rail';
import { FilterChips } from '../../../components/discover/FilterChips';
import { CommunityRow, TileCard } from '../../../components/discover/DiscoverCards';
import { THEMES } from '../../../lib/theme';

/**
 * Jank audit #8: RN-web's StyleSheet.create compiles every style object to
 * atomic CSS on each call, and Discover called a `styles(colors)` factory in
 * every render of every rail (x6), chip row and card. Styles are now built
 * once per theme and reused.
 */
describe('byTheme', () => {
  it('builds once per theme and hands back the same sheet', () => {
    const factory = jest.fn((c: typeof THEMES.light) => ({ ink: c.ink }));
    const styles = byTheme(factory);
    expect(styles(THEMES.light)).toBe(styles(THEMES.light));
    expect(styles(THEMES.dark)).not.toBe(styles(THEMES.light));
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('Discover builds no styles on a re-render', () => {
  it('Rail, FilterChips and the v2 cards reuse their sheets', () => {
    const tree = () => (
      <Rail title="T" status="ready" count={1} emptyBody="x" onRetry={jest.fn()}
        filters={<FilterChips chips={[{ key: 'a', label: 'A' }]} value="a" onChange={jest.fn()} label="F" />}>
        <TileCard seed="s" title="Shop" meta="Lisbon" width={146} onPress={jest.fn()} />
        <CommunityRow id="c" name="Climbers" meta="20 members" join="joined" onPress={jest.fn()} />
      </Rail>
    );
    const v = render(tree());
    const create = jest.spyOn(StyleSheet, 'create');
    v.rerender(tree());
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });
});
