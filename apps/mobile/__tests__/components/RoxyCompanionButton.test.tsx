import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Mock expo-router
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

import { RoxyCompanionButton } from '../../components/ui/RoxyCompanionButton';

beforeEach(() => {
  mockPush.mockClear();
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

  it('navigates to roxy-chat on press', () => {
    const { getByTestId } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/grow/roxy-chat');
  });

  it('does not call router.push when visible is false (not rendered)', () => {
    const { queryByTestId } = render(<RoxyCompanionButton visible={false} />);
    expect(queryByTestId('fab-button')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
