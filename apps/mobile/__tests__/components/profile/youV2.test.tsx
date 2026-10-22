import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../../lib/streaks', () => ({ recordDailyCheckin: jest.fn(async () => 7) }));
const mockUpdate = jest.fn(async () => undefined);
jest.mock('../../../store/profileStore', () => ({
  useProfileStore: (sel: (s: object) => unknown) =>
    sel({ profile: { is_dating_mode: true, is_ghost: false }, updateProfile: mockUpdate }),
}));
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  },
}));

import { Text } from 'react-native';
import { SelfControls } from '../../../components/profile/SelfControls';
import { YouRows } from '../../../components/profile/YouRows';
import { ProfileShell, PROFILE_AVATAR_SEAM, PROFILE_BAR_HEIGHT, PROFILE_COVER_HEIGHT } from '../../../components/profile/ProfileShell';
import type { PopulatedTabs } from '../../../components/profile/profileVariant';
import { THEMES } from '../../../lib/theme';

const light = THEMES.light;
const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

beforeEach(() => {
  mockPush.mockClear();
  mockUpdate.mockClear();
});

/**
 * You, v2 (design direction › You): a flat header, Dating and Ghost as plain
 * rows with a one-line explanation each, a quiet Mini Wins card (streak in
 * warningInk), then Tickets & orders, Saved, Sell on Roxy, Settings & safety.
 * No XP bar, no level badge, no gradient cover.
 */
describe('SelfControls v2 — Dating and Ghost as plain rows', () => {
  it('draws each as a row with its one-line explanation and an M3 switch', async () => {
    const v = render(<SelfControls userId="u1" onOpenDaily={jest.fn()} />);
    await waitFor(() => expect(v.getByText('7-day streak')).toBeTruthy());
    const dating = v.getByTestId('toggle-dating');
    expect(dating.props.accessibilityRole).toBe('switch');
    expect(dating.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(v.getByText('Dating')).toBeTruthy();
    expect(v.getByText('Off means friends only. Nobody sees you in dating.')).toBeTruthy();
    expect(v.getByText('Ghost mode')).toBeTruthy();
    expect(v.getByText('Hidden from discovery. You can still use everything.')).toBeTruthy();
    // On = pink track; off = raised track with a control outline.
    expect(flat(v.getByTestId('toggle-dating-track')).backgroundColor).toBe(light.pink);
    const off = flat(v.getByTestId('toggle-ghost-track'));
    expect(off.backgroundColor).toBe(light.raised);
    expect(off.borderColor).toBe(light.control);
  });

  it('flips a switch through the profile store', async () => {
    const v = render(<SelfControls userId="u1" />);
    fireEvent.press(v.getByTestId('toggle-ghost'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ is_ghost: true }));
  });

  it('keeps Mini Wins as a quiet card: streak in warningInk, no emoji', async () => {
    const onOpenDaily = jest.fn();
    const v = render(<SelfControls userId="u1" onOpenDaily={onOpenDaily} />);
    await waitFor(() => expect(v.getByText('7-day streak')).toBeTruthy());
    expect(flat(v.getByText('7-day streak')).color).toBe(light.warningInk);
    const card = v.getByTestId('you-mini-wins');
    expect(within(card).queryByText(/\p{Extended_Pictographic}/u)).toBeNull();
    expect(within(card).getByText('Mini Wins')).toBeTruthy();
    fireEvent.press(card);
    expect(onOpenDaily).toHaveBeenCalledTimes(1);
  });
});

describe('YouRows — the places You leads to', () => {
  it('lists Tickets & orders, Saved, Sell on Roxy and Settings & safety', () => {
    const onOpenSaved = jest.fn();
    const v = render(<YouRows userId="u1" walletCount={2} savedCount={5} onOpenSaved={onOpenSaved} />);
    expect(v.getByText('Tickets & orders')).toBeTruthy();
    expect(v.getByText('Saved')).toBeTruthy();
    expect(v.getByText('Sell on Roxy')).toBeTruthy();
    expect(v.getByText('Settings & safety')).toBeTruthy();
    expect(String(v.getByTestId('you-row-wallet').props.accessibilityLabel)).toBe('Tickets & orders, 2');
    fireEvent.press(v.getByTestId('you-row-wallet'));
    expect(mockPush).toHaveBeenCalledWith('/tickets');
    fireEvent.press(v.getByTestId('you-row-saved'));
    expect(onOpenSaved).toHaveBeenCalled();
    fireEvent.press(v.getByTestId('you-row-sell'));
    expect(mockPush).toHaveBeenCalledWith('/support');
    fireEvent.press(v.getByTestId('you-row-settings'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/you/settings');
  });

  it('ships no Premium row (held for Nicole) and no dead button', () => {
    const v = render(<YouRows userId="u1" onOpenSaved={jest.fn()} />);
    expect(v.queryByText(/Premium/)).toBeNull();
  });
});

const NONE: PopulatedTabs = {
  posts: true, thoughts: false, shop: false, events: false, rooms: false,
  games: false, about: false, saved: false,
};

describe('ProfileShell v2 header', () => {
  const shell = (over: Partial<React.ComponentProps<typeof ProfileShell>> = {}) =>
    render(
      <ProfileShell
        variant="self"
        name="Amara Okafor"
        primaryAction={{ label: 'Edit', onPress: jest.fn() }}
        populated={NONE}
        renderTab={() => <Text>tab</Text>}
        {...over}
      />,
    );

  it('is flat without an uploaded cover: no gradient anywhere in the header', () => {
    const v = shell();
    const header = v.getByTestId('profile-header');
    expect(within(header).UNSAFE_queryAllByType('LinearGradient' as never)).toHaveLength(0);
    expect(flat(v.getByTestId('profile-cover')).backgroundColor).toBe(light.ground);
    expect(flat(v.getByTestId('profile-cover')).height).toBe(PROFILE_BAR_HEIGHT);
    expect(flat(v.getByTestId('profile-avatar')).top).toBe(PROFILE_BAR_HEIGHT - PROFILE_AVATAR_SEAM);
  });

  it('shows the uploaded cover photo, with the avatar on its seam', () => {
    const v = shell({ coverUrl: 'https://cdn.example/cover.jpg' });
    expect(v.getByTestId('profile-cover-photo')).toBeTruthy();
    expect(flat(v.getByTestId('profile-avatar')).top).toBe(PROFILE_COVER_HEIGHT - PROFILE_AVATAR_SEAM);
  });

  it('draws her initials on an identity field, not a gradient', () => {
    const v = shell();
    const initials = v.getByTestId('profile-avatar-initials');
    expect(within(initials).getByText('AO')).toBeTruthy();
    expect(Object.values(THEMES.light)).not.toContain(undefined);
    expect(String(flat(initials).backgroundColor)).toMatch(/^#/);
  });

  it('makes Edit a quiet raised pill', () => {
    const v = shell();
    const edit = v.getByTestId('profile-primary-action');
    expect(flat(edit).backgroundColor).toBe(light.raised);
    expect(flat(v.getByText('Edit')).color).toBe(light.ink);
  });

  it('names Official and Approved seller in sentence case, never caps pills', () => {
    const v = shell({ variant: 'seller', official: true, sellerApproved: true });
    expect(within(v.getByTestId('profile-official-chip')).getByText('Official')).toBeTruthy();
    expect(within(v.getByTestId('profile-seller-chip')).getByText('Approved seller')).toBeTruthy();
    expect(v.queryByText('OFFICIAL')).toBeNull();
    expect(v.queryByText('APPROVED SELLER')).toBeNull();
  });
});
