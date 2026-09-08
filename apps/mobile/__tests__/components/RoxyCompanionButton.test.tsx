import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockPathname = jest.fn(() => '/(tabs)/grow');
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import { RoxyCompanionButton } from '../../components/ui/RoxyCompanionButton';
import { useCommunityFilterStore } from '../../store/communityFilterStore';
import { useCommunityStore } from '../../store/communityStore';

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockClear();
  mockPathname.mockReturnValue('/(tabs)/grow');
  useCommunityFilterStore.setState({ selectedCommunityId: null, filterable: false });
  useCommunityStore.setState({ joinedCommunities: [] });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('RoxyCompanionButton', () => {
  it('renders when visible is true (default)', () => {
    const { getByTestId } = render(<RoxyCompanionButton />);
    expect(getByTestId('fab-button')).toBeTruthy();
  });

  it('renders nothing when visible is false', () => {
    const { queryByTestId } = render(<RoxyCompanionButton visible={false} />);
    expect(queryByTestId('fab-button')).toBeNull();
  });

  it('does not call router.push when visible is false (not rendered)', () => {
    const { queryByTestId } = render(<RoxyCompanionButton visible={false} />);
    expect(queryByTestId('fab-button')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('long-press navigates straight to roxy-chat, bypassing the action stack', () => {
    const { getByTestId } = render(<RoxyCompanionButton />);
    fireEvent(getByTestId('fab-button'), 'longPress');
    expect(mockPush).toHaveBeenCalledWith('/roxy-chat');
  });

  it('tap opens the pop-out action stack instead of navigating immediately', () => {
    const { getByTestId, getByLabelText } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(getByLabelText('Chat with Roxy')).toBeTruthy();
    expect(getByLabelText('Search Roxy')).toBeTruthy();
    expect(getByLabelText('Filter this view')).toBeTruthy();
  });

  it('"Chat with Roxy" pill navigates to roxy-chat', () => {
    const { getByTestId, getByLabelText } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    fireEvent.press(getByLabelText('Chat with Roxy'));
    expect(mockPush).toHaveBeenCalledWith('/roxy-chat');
  });

  it('"Search Roxy" pill pushes /search', () => {
    const { getByTestId, getByLabelText } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    fireEvent.press(getByLabelText('Search Roxy'));
    expect(mockPush).toHaveBeenCalledWith('/search');
  });

  // Connect and Build were folded into the 3.0 four-tab shell and their own
  // CommunityContextSwitcher instances went with them — the Feed tab's
  // Communities segment is the only place a switcher renders now. The hint
  // Disabled is decided by `filterable`, never by the route.
  //
  // Two earlier versions of this decided it by pathname, and both were wrong in
  // the same way. The first named `/connect` and `/build`, tabs the 3.0
  // flattening deleted. The second named `/feed` — and passed for exactly the
  // broken case, because the Feed honours a community filter on ONE of its
  // three segments. On For You the scope is `announcements`, `ReelsFeed`
  // ignores `communityIds` entirely, and the action wrote a selection that
  // changed nothing on screen with no explanation.
  //
  // The hint copy is asserted too: a stale place name in a disabled-state hint
  // is invisible to every other kind of check.
  it('"Filter this view" is disabled while no surface claims the filter, on any route', () => {
    for (const route of ['/(tabs)/discover', '/(tabs)/feed', '/(tabs)/you']) {
      mockPathname.mockReturnValue(route);
      const { getByTestId, getByText, getByLabelText, unmount } = render(<RoxyCompanionButton />);
      fireEvent.press(getByTestId('fab-button'));

      expect(getByText('Works on Feed › Communities')).toBeTruthy();
      expect(getByLabelText('Filter this view').props.accessibilityState?.disabled).toBe(true);
      unmount();
    }
  });

  it('being on the Feed route is not on its own enough to make a selection', () => {
    mockPathname.mockReturnValue('/(tabs)/feed');
    useCommunityStore.setState({
      joinedCommunities: [
        { id: 'c1', name: 'Femme Fest', slug: 'femme-fest', description: null, cover_image_url: null, category: 'social', is_private: false, member_count: 10, created_by: 'u1', created_at: '2026-01-01' },
      ],
    });
    const { getByTestId, getByLabelText, queryByTestId } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    fireEvent.press(getByLabelText('Filter this view'));

    expect(queryByTestId('fab-filter-c1')).toBeNull();
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBeNull();
  });

  it('names no tab that has been retired', () => {
    mockPathname.mockReturnValue('/(tabs)/discover');
    const { getByTestId, queryByText } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));

    for (const dead of [/Connect/, /Build/, /Grow/, /Play/]) {
      expect(queryByText(dead)).toBeNull();
    }
  });

  it('"Filter this view" expands the joined-community list on a filterable view and applies a selection', () => {
    mockPathname.mockReturnValue('/(tabs)/feed');
    useCommunityFilterStore.setState({ filterable: true });
    useCommunityStore.setState({
      joinedCommunities: [
        { id: 'c1', name: 'Femme Fest', slug: 'femme-fest', description: null, cover_image_url: null, category: 'social', is_private: false, member_count: 10, created_by: 'u1', created_at: '2026-01-01' },
      ],
    });
    const { getByTestId, getByLabelText } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    fireEvent.press(getByLabelText('Filter this view'));
    fireEvent.press(getByTestId('fab-filter-c1'));
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBe('c1');
  });

  it('"Filter this view" on a filterable view also lets her clear back to All Communities', () => {
    mockPathname.mockReturnValue('/(tabs)/feed');
    useCommunityFilterStore.setState({ selectedCommunityId: 'c1', filterable: true });
    const { getByTestId, getByLabelText } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    fireEvent.press(getByLabelText('Filter this view'));
    fireEvent.press(getByTestId('fab-filter-all'));
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBeNull();
  });

  it('scrim tap closes the sheet', () => {
    const { getByTestId, getByLabelText, queryByLabelText } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    expect(getByLabelText('Chat with Roxy')).toBeTruthy();
    fireEvent.press(getByLabelText('Close Roxy menu'));
    expect(queryByLabelText('Chat with Roxy')).toBeNull();
  });
});
