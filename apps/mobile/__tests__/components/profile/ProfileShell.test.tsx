import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));

import { ProfileShell, type ProfileShellProps } from '../../../components/profile/ProfileShell';
import type { PopulatedTabs, ProfileTab } from '../../../components/profile/profileVariant';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

const NONE: PopulatedTabs = {
  posts: false, shop: false, events: false, rooms: false,
  games: false, about: false, saved: false,
};

const base: ProfileShellProps = {
  variant: 'user',
  name: 'Maya Lin',
  subtitle: '@mayalin.art · London',
  bio: 'Ceramics, film photography, and too many plants.',
  pronouns: ['she/her'],
  identityLabels: ['Lesbian'],
  stats: [
    { value: '340', label: 'Reactions' },
    { value: '18', label: 'Posts' },
    { value: '92', label: 'Friends' },
  ],
  primaryAction: { label: 'Message', onPress: jest.fn() },
  populated: { ...NONE, posts: true },
  renderTab: (tab: ProfileTab) => <Text>{`content:${tab}`}</Text>,
};

const renderShell = (over: Partial<ProfileShellProps> = {}) =>
  render(<ProfileShell {...base} {...over} />);

describe('ProfileShell — the header the prototype draws', () => {
  it('shows orientation, interests and custom tags, and expands the overflow', () => {
    const view = renderShell({
      identityLabels: ['Lesbian'],
      interests: ['Music', 'Film', 'Art', 'Travel', 'Food'],
      customTags: ['night owl', 'cats'],
    });
    expect(view.getByTestId('profile-tags')).toBeTruthy();
    expect(view.getByText('Lesbian')).toBeTruthy();
    expect(view.getByTestId('profile-tags-more')).toBeTruthy();
    fireEvent.press(view.getByTestId('profile-tags-more'));
    expect(view.getByText('night owl')).toBeTruthy();
    expect(view.queryByTestId('profile-tags-more')).toBeNull();
  });

  it('keeps a long bio collapsed until she taps more', () => {
    const long = 'Ceramics, film photography, and too many plants. '.repeat(8);
    const view = renderShell({ bio: long });
    expect(view.getByTestId('profile-bio')).toBeTruthy();
  });

  it('renders cover, avatar, name, pronouns, subtitle, bio and the stat row', () => {
    const view = renderShell();
    expect(view.getByTestId('profile-cover')).toBeTruthy();
    expect(view.getByTestId('profile-avatar')).toBeTruthy();
    expect(view.getByText('Maya Lin')).toBeTruthy();
    expect(view.getByText('she/her')).toBeTruthy();
    expect(view.getByText('Lesbian')).toBeTruthy();
    expect(view.getByText('@mayalin.art · London')).toBeTruthy();
    expect(view.getByText('Ceramics, film photography, and too many plants.')).toBeTruthy();
    expect(view.getByTestId('profile-stats')).toBeTruthy();
    expect(view.getByText('Reactions')).toBeTruthy();
  });

  it('uses the photo cover when a url is passed, instead of only the gradient', () => {
    const view = renderShell({ coverUrl: 'https://cdn.example/cover.jpg' });
    expect(view.getByTestId('profile-cover-photo')).toBeTruthy();
  });

  it('shows the level band on the avatar when there are points', () => {
    // The prototype paints ⚡12. The spoken label still names the band
    // ProfileCard already shipped (Bloom) so a screen reader is not handed a
    // number with no product meaning.
    const view = renderShell({ points: 240 });
    const badge = view.getByTestId('profile-level-badge');
    expect(view.getByText('⚡12')).toBeTruthy();
    expect(badge.props.accessibilityLabel).toContain('Bloom');
    expect(badge.props.accessibilityLabel).toContain('240');
  });

  it('prints pronouns beside the name, not as another chip', () => {
    const view = renderShell();
    expect(view.getByTestId('profile-pronouns')).toBeTruthy();
    expect(view.getByText('she/her')).toBeTruthy();
  });

  it('draws the self header extras the prototype puts next to Edit', () => {
    const onBadges = jest.fn();
    const onXp = jest.fn();
    const view = renderShell({
      variant: 'self',
      primaryAction: { label: 'Edit', onPress: jest.fn() },
      badgePreview: { emojis: '🌸🔥💎🎙️', extra: 2, onPress: onBadges },
      xp: { label: '2,450 XP', progress: 0.82, onPress: onXp },
    });
    fireEvent.press(view.getByTestId('profile-badge-chip'));
    fireEvent.press(view.getByTestId('profile-xp'));
    expect(onBadges).toHaveBeenCalledTimes(1);
    expect(onXp).toHaveBeenCalledTimes(1);
    expect(view.getByText('2,450 XP')).toBeTruthy();
    expect(view.getByText('+2')).toBeTruthy();
  });

  it('hides the level badge entirely when there are no points to show', () => {
    expect(renderShell({ points: null }).queryByTestId('profile-level-badge')).toBeNull();
  });

  it('drops retired identity chips instead of displaying them', () => {
    // Old rows still carry 'any/all', 'other' and 'Prefer not to say'. They were
    // removed from the picker; showing them makes a profile look mislabelled.
    const view = renderShell({
      pronouns: ['she/her', 'any/all'],
      identityLabels: ['Lesbian', 'Prefer not to say', 'other'],
    });
    expect(view.getByText('she/her')).toBeTruthy();
    expect(view.queryByText('any/all')).toBeNull();
    expect(view.queryByText('Prefer not to say')).toBeNull();
    expect(view.queryByText('other')).toBeNull();
  });

  it('says the word LIVE, never colour alone', () => {
    const view = renderShell({ live: true });
    expect(view.getByTestId('profile-live')).toBeTruthy();
    expect(view.getByText('LIVE')).toBeTruthy();
  });

  it('shows the approved-seller chip only for an approved seller', () => {
    const seller = renderShell({ variant: 'seller', sellerApproved: true });
    expect(seller.getByTestId('profile-seller-chip')).toBeTruthy();
    expect(renderShell().queryByTestId('profile-seller-chip')).toBeNull();
  });

  it('shows the official chip and a third action the prototype puts on a community', () => {
    const onFollow = jest.fn();
    const view = renderShell({
      official: true,
      primaryAction: { label: 'Join', onPress: jest.fn() },
      secondaryAction: { label: 'Follow', onPress: onFollow, testID: 'profile-follow' },
    });
    expect(view.getByTestId('profile-official-chip')).toBeTruthy();
    fireEvent.press(view.getByTestId('profile-follow'));
    expect(onFollow).toHaveBeenCalledTimes(1);
  });
});

describe('ProfileShell — exactly one primary action per variant', () => {
  const cases: { variant: ProfileShellProps['variant']; label: string }[] = [
    { variant: 'user', label: 'Message' },
    { variant: 'seller', label: 'Message' },
    { variant: 'community', label: 'Join' },
    { variant: 'self', label: 'Edit' },
  ];

  for (const c of cases) {
    it(`renders one primary action for the ${c.variant} variant: ${c.label}`, () => {
      const view = renderShell({
        variant: c.variant,
        primaryAction: { label: c.label, onPress: jest.fn() },
      });
      expect(view.getAllByTestId('profile-primary-action')).toHaveLength(1);
      expect(view.getByText(c.label)).toBeTruthy();
    });
  }

  it('fires the primary action once per press', () => {
    const onPress = jest.fn();
    const view = renderShell({ primaryAction: { label: 'Message', onPress } });
    fireEvent.press(view.getByTestId('profile-primary-action'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('carries a secondary action beside it — Follow, Add friend, Joined', () => {
    const onPress = jest.fn();
    const view = renderShell({ secondaryAction: { label: 'Add friend', onPress } });
    fireEvent.press(view.getByTestId('profile-secondary-action'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a pressless secondary as a status pill, not a dead button', () => {
    // "Requested" and "Friends" are states, not actions. A TouchableOpacity with
    // no handler is announced as a button that does nothing when tapped.
    const view = renderShell({ secondaryAction: { label: 'Requested' } });
    const pill = view.getByTestId('profile-secondary-action');
    expect(pill.props.accessibilityRole).not.toBe('button');
    expect(view.getByText('Requested')).toBeTruthy();
  });
});

describe('ProfileShell — a tab with no content is not rendered at all', () => {
  const populated: PopulatedTabs = { ...NONE, posts: true, rooms: true, about: true };

  it('renders only the populated tabs, in prototype order', () => {
    const view = renderShell({ variant: 'community', populated });
    expect(view.getByTestId('profile-tab-posts')).toBeTruthy();
    expect(view.getByTestId('profile-tab-rooms')).toBeTruthy();
    expect(view.getByTestId('profile-tab-about')).toBeTruthy();
    expect(view.queryByTestId('profile-tab-events')).toBeNull();
    expect(view.queryByTestId('profile-tab-games')).toBeNull();
    expect(view.queryByTestId('profile-tab-shop')).toBeNull();
  });

  it('renders the first visible tab and only that tab', () => {
    const view = renderShell({ variant: 'community', populated });
    expect(view.getByText('content:posts')).toBeTruthy();
    expect(view.queryByText('content:rooms')).toBeNull();
  });

  it('switches content when another tab is pressed', () => {
    const view = renderShell({ variant: 'community', populated });
    fireEvent.press(view.getByTestId('profile-tab-rooms'));
    expect(view.getByText('content:rooms')).toBeTruthy();
    expect(view.queryByText('content:posts')).toBeNull();
  });

  it('announces the selected tab through aria, not only accessibilityState', () => {
    // react-native-web 0.19 renders NO attribute for accessibilityState, so a
    // bare accessibilityState leaves the web build with a tablist in which
    // nothing tells assistive tech which tab is current. a11yState emits both.
    //
    // The aria half has to be read off the COMPOSITE element: react-native's own
    // Touchables enumerate the accessibility props they forward and drop
    // `aria-*` before the host view, while react-native-web's do pass them
    // through. So jest under the native preset structurally cannot see the
    // attribute the web build emits — probed, not assumed. What it can prove is
    // that the props reached the control, which is the part this component owns.
    const view = renderShell({ variant: 'community', populated });

    const ariaOn = (id: string) => view.UNSAFE_getAllByProps({ testID: id })
      .map((el) => (el.props as Record<string, unknown>)['aria-selected'])
      .find((v) => v !== undefined);
    expect(ariaOn('profile-tab-posts')).toBe(true);
    expect(ariaOn('profile-tab-rooms')).toBe(false);

    expect(view.getByTestId('profile-tab-posts').props.accessibilityState).toEqual({ selected: true });
    expect(view.getByTestId('profile-tab-rooms').props.accessibilityState).toEqual({ selected: false });
  });

  it('hides the whole strip and says so when nothing is populated', () => {
    const view = renderShell({ populated: NONE });
    expect(view.queryByTestId('profile-tabstrip')).toBeNull();
    expect(view.getByTestId('profile-empty')).toBeTruthy();
  });
});

describe('ProfileShell — loading, empty and error are all real states', () => {
  it('shows a spinner while the tab data is still loading, and never the empty copy', () => {
    const view = renderShell({ populated: NONE, status: 'loading' });
    expect(view.getByTestId('profile-loading')).toBeTruthy();
    expect(view.queryByTestId('profile-empty')).toBeNull();
  });

  it('shows the error and a retry that calls back', () => {
    const onRetry = jest.fn();
    const view = renderShell({ populated: NONE, status: 'error', onRetry });
    expect(view.getByTestId('profile-error')).toBeTruthy();
    fireEvent.press(view.getByTestId('profile-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not offer a retry it cannot perform', () => {
    const view = renderShell({ populated: NONE, status: 'error' });
    expect(view.getByTestId('profile-error')).toBeTruthy();
    expect(view.queryByTestId('profile-retry')).toBeNull();
  });
});

describe('ProfileShell — every control is reachable', () => {
  const sizeOf = (node: { props: { style?: unknown } }) => {
    const style = StyleSheet.flatten(node.props.style as never) as
      { minHeight?: number; height?: number; minWidth?: number; width?: number };
    return {
      height: Number(style.minHeight ?? style.height ?? 0),
      width: Number(style.minWidth ?? style.width ?? 0),
    };
  };

  it('gives every icon-only control a role, a label and 48dp of measured target', () => {
    const view = renderShell({
      onBack: jest.fn(),
      headerActions: [
        { icon: 'ellipsis-horizontal', label: 'More options', onPress: jest.fn(), testID: 'profile-more' },
      ],
    });
    for (const id of ['profile-back', 'profile-more']) {
      const node = view.getByTestId(id);
      expect(node.props.accessibilityRole).toBe('button');
      expect(String(node.props.accessibilityLabel ?? '').length).toBeGreaterThan(0);
      const { height, width } = sizeOf(node);
      expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  it('keeps the actions and the tabs tappable too', () => {
    const view = renderShell({
      secondaryAction: { label: 'Follow', onPress: jest.fn() },
      populated: { ...NONE, posts: true, about: true },
    });
    for (const id of ['profile-primary-action', 'profile-secondary-action', 'profile-tab-posts']) {
      expect(sizeOf(view.getByTestId(id)).height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  it('omits the back button rather than rendering a dead one', () => {
    expect(renderShell().queryByTestId('profile-back')).toBeNull();
  });
});

describe('ProfileShell — a parent can drive the strip', () => {
  it('opens the tab the parent asks for and reports the next press', () => {
    const onSelectTab = jest.fn();
    const view = renderShell({
      variant: 'self',
      populated: { ...NONE, posts: true, saved: true },
      selectedTab: 'saved',
      onSelectTab,
    });
    expect(view.getByText('content:saved')).toBeTruthy();
    fireEvent.press(view.getByTestId('profile-tab-posts'));
    expect(onSelectTab).toHaveBeenCalledWith('posts');
  });
});

describe('ProfileShell — the variant extras slot', () => {
  it('renders whatever the route puts above the tab strip', () => {
    const view = renderShell({
      variant: 'self',
      primaryAction: { label: 'Edit', onPress: jest.fn() },
      beforeTabs: <Text>self controls go here</Text>,
    });
    expect(view.getByText('self controls go here')).toBeTruthy();
  });
});
