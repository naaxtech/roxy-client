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
  useCommunityFilterStore.setState({ selectedCommunityId: null });
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

  it('"Filter this view" is disabled outside Connect/Build with a hint', () => {
    mockPathname.mockReturnValue('/(tabs)/grow');
    const { getByTestId, getByText } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    expect(getByText('Works on Connect & Build')).toBeTruthy();
  });

  it('"Filter this view" expands the joined-community list on the Connect tab and applies a selection', () => {
    mockPathname.mockReturnValue('/(tabs)/connect');
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

  it('"Filter this view" expands on the Build tab too, and "All Communities" clears the filter', () => {
    mockPathname.mockReturnValue('/(tabs)/build');
    useCommunityFilterStore.setState({ selectedCommunityId: 'c1' });
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
