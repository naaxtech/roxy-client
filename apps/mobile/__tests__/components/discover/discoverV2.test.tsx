import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { render, fireEvent, within } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import {
  EventPoster, CommunityRow, LiveRow, ListRow, MemberCard, TileCard,
} from '../../../components/discover/DiscoverCards';
import { FilterChips } from '../../../components/discover/FilterChips';
import { Rail } from '../../../components/discover/Rail';
import {
  DISCOVER_CHIPS, EVENT_FILTERS, ECONOMY_FILTERS,
} from '../../../components/discover/discoverFilters';
import { THEMES, IDENTITY, BRAND_INK } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const light = THEMES.light;

/**
 * Discover v2 (design direction › Discover, board v2-05): posters in identity
 * colours, community rows with crest squircles and a tonal Join, Top 10
 * photo-first with plain rank numbers, Live = dot + word, chips on `raised`
 * with `pinkContainer` selection and an end fade.
 */
describe('EventPoster', () => {
  const poster = (over: Partial<React.ComponentProps<typeof EventPoster>> = {}) =>
    render(
      <EventPoster
        seed="Kraków Queer Climbers"
        title="Boulders & pierogi"
        when="Sat 25 Oct"
        host="Kraków Queer Climbers"
        detail="In person · Free"
        width={146}
        onPress={jest.fn()}
        testID="p"
        {...over}
      />,
    );

  it('is a flat identity field carrying onBrandPink ink, no gradient', () => {
    const v = poster();
    const card = v.getByTestId('p');
    expect(IDENTITY as readonly string[]).toContain(flat(card).backgroundColor);
    expect(flat(v.getByText('Boulders & pierogi')).color).toBe(BRAND_INK);
    expect(v.UNSAFE_queryAllByType('LinearGradient' as never)).toHaveLength(0);
  });

  it('says when, what, who and how in words a screen reader hears too', () => {
    const v = poster();
    const label = String(v.getByTestId('p').props.accessibilityLabel);
    for (const part of ['Boulders & pierogi', 'Sat 25 Oct', 'Kraków Queer Climbers', 'In person · Free']) {
      expect(label).toContain(part);
    }
    expect(v.getByText('Boulders & pierogi').props.numberOfLines).toBe(3);
  });
});

describe('CommunityRow', () => {
  it('draws a crest squircle with initials, the count line and a tonal Join', () => {
    const onJoin = jest.fn();
    const v = render(
      <CommunityRow
        id="c1" name="Queer Parents Toronto" meta="880 members"
        join="join" onJoin={onJoin} onPress={jest.fn()} testID="row"
      />,
    );
    expect(within(v.getByTestId('row')).getByText('QT')).toBeTruthy();
    expect(v.getByText('880 members')).toBeTruthy();
    const join = v.getByTestId('community-join-c1');
    expect(flat(join).backgroundColor).toBe(light.pinkContainer);
    expect(flat(v.getByText('Join')).color).toBe(light.onPinkContainer);
    expect(Number(flat(join).minHeight)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    fireEvent.press(join);
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it('shows Joined and Requested as quiet states, not buttons', () => {
    for (const [state, word] of [['joined', 'Joined'], ['requested', 'Requested']] as const) {
      const v = render(
        <CommunityRow id="c1" name="Late Bloomers" meta="2,310 members" join={state} onPress={jest.fn()} />,
      );
      const pill = v.getByTestId('community-join-c1');
      expect(pill.props.accessibilityRole).toBe('text');
      expect(flat(pill).backgroundColor).toBe(light.raised);
      expect(v.getByText(word)).toBeTruthy();
    }
  });
});

describe('LiveRow', () => {
  it('says LIVE with a dot and the word, never colour alone', () => {
    const v = render(
      <LiveRow seed="Queer Gamers" title="Queer Gamers" count="14 listening" onPress={jest.fn()} testID="live" />,
    );
    // The dot is decoration for a screen reader (the word says it), so it is
    // hidden from accessibility and found with includeHiddenElements.
    expect(v.getByTestId('live-dot', { includeHiddenElements: true })).toBeTruthy();
    expect(v.getByText('LIVE · 14 listening')).toBeTruthy();
  });
});

describe('MemberCard (Top 10)', () => {
  it('is photo-first with a plain rank number and no MEMBER tag', () => {
    const v = render(
      <MemberCard
        rank={2} name="Jessa Brigole" subtitle="Archivist" avatarUrl="https://x/y.jpg"
        seed="u2" width={146} onPress={jest.fn()} testID="m"
      />,
    );
    expect(v.getByTestId('m-photo')).toBeTruthy();
    expect(v.getByTestId('m-rank').props.children).toBe(2);
    expect(v.queryByText(/MEMBER/)).toBeNull();
    expect(String(v.getByTestId('m').props.accessibilityLabel)).toBe('Number 2. Jessa Brigole. Archivist');
  });

  it('falls back to her initials on an identity field when there is no photo', () => {
    const v = render(
      <MemberCard rank={1} name="Dad Ally" subtitle="12 points" seed="u1" width={146} onPress={jest.fn()} testID="m" />,
    );
    expect(within(v.getByTestId('m-initials')).getByText('DA')).toBeTruthy();
  });
});

describe('ListRow and TileCard', () => {
  it('ListRow wraps a long subtitle to two lines', () => {
    const v = render(
      <ListRow
        icon="game-controller-outline" seed="Speed Dating" title="Speed Dating"
        subtitle="5-minute video speed dates. Match with someone new." onPress={jest.fn()} testID="g"
      />,
    );
    expect(v.getByText('5-minute video speed dates. Match with someone new.').props.numberOfLines).toBe(2);
  });

  it('TileCard reserves two title lines so a rail stays level', () => {
    const a = render(<TileCard seed="a" title="Bound" meta="London" width={146} onPress={jest.fn()} />);
    const b = render(<TileCard seed="b" title="The Rise and Fall of a Midwest Princess" meta="x" width={146} onPress={jest.fn()} />);
    expect(flat(a.getByText('Bound')).minHeight).toBeDefined();
    expect(flat(a.getByText('Bound')).minHeight).toBe(flat(b.getByText('The Rise and Fall of a Midwest Princess')).minHeight);
  });
});

describe('FilterChips v2', () => {
  const CHIPS = [
    { key: 'all' as const, label: 'For you' },
    { key: 'events' as const, label: 'Events' },
  ];

  it('rests on raised and selects with a pinkContainer fill and emphasized label', () => {
    const v = render(<FilterChips chips={CHIPS} value="all" onChange={jest.fn()} label="F" emphasis="primary" testID="c" />);
    expect(flat(v.getByTestId('c-all-pill')).backgroundColor).toBe(light.pinkContainer);
    expect(flat(v.getByText('For you')).color).toBe(light.onPinkContainer);
    expect(flat(v.getByTestId('c-events-pill')).backgroundColor).toBe(light.raised);
    expect(flat(v.getByText('Events')).color).toBe(light.ink2);
    expect(flat(v.getByText('For you')).fontFamily).not.toBe(flat(v.getByText('Events')).fontFamily);
  });

  it('fades the end of the top row so it reads as scrollable', () => {
    const v = render(<FilterChips chips={CHIPS} value="all" onChange={jest.fn()} label="F" emphasis="primary" testID="c" />);
    expect(v.getByTestId('c-fade')).toBeTruthy();
  });
});

describe('Rail v2 states', () => {
  it('loads as skeletons at the final layout, never a spinner', () => {
    const v = render(
      <Rail title="Live now" status="loading" count={0} emptyBody="x" onRetry={jest.fn()} testID="r">
        {null}
      </Rail>,
    );
    expect(v.getByTestId('r-loading')).toBeTruthy();
    expect(v.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('says what happened and what to do next on error', () => {
    const onRetry = jest.fn();
    const v = render(
      <Rail title="Live now" status="error" count={0} emptyBody="x" onRetry={onRetry} testID="r">
        {null}
      </Rail>,
    );
    expect(v.getByText('Live now didn’t load. Check your connection and try again.')).toBeTruthy();
    fireEvent.press(v.getByLabelText('Try loading Live now again'));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('chip copy', () => {
  it('has no flower and no emoji anywhere in a chip label', () => {
    for (const chip of [...DISCOVER_CHIPS, ...EVENT_FILTERS, ...ECONOMY_FILTERS]) {
      expect(chip.label).not.toMatch(/[✿❀✾❁]|\p{Extended_Pictographic}/u);
    }
  });
});
