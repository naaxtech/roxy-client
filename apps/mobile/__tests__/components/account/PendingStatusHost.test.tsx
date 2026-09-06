import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PendingStatusHost } from '../../../components/account/PendingStatusHost';
import { useProfileStore } from '../../../store/profileStore';
import { useAuthStore } from '../../../store/authStore';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

beforeEach(() => {
  mockPush.mockClear();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  useAuthStore.setState({ user: { id: 'u-pending' } as never });
  useProfileStore.setState({
    profile: { vetting_status: 'pending' } as never,
  });
});

describe('PendingStatusHost', () => {
  it('is silent for an approved member', () => {
    useProfileStore.setState({
      profile: { vetting_status: 'approved' } as never,
    });
    const { queryByTestId } = render(<PendingStatusHost />);
    expect(queryByTestId('pending-status-sheet')).toBeNull();
  });

  it('explains pending status once, then remembers the dismiss', async () => {
    const { getByTestId, queryByTestId } = render(<PendingStatusHost />);
    await waitFor(() => expect(getByTestId('pending-status-sheet')).toBeTruthy());
    expect(getByTestId('pending-status-sheet')).toHaveTextContent(/archive/i);
    expect(getByTestId('pending-status-sheet')).toHaveTextContent(/official chat/i);

    fireEvent.press(getByTestId('pending-status-done'));
    expect(queryByTestId('pending-status-sheet')).toBeNull();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'roxy_pending_status_seen:u-pending',
      '1',
    );
  });

  it('does not open the sheet again after it has been seen', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('1');
    const { queryByTestId } = render(<PendingStatusHost />);
    await waitFor(() =>
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(
        'roxy_pending_status_seen:u-pending',
      ),
    );
    expect(queryByTestId('pending-status-sheet')).toBeNull();
  });

  it('offers a way to add to the application without trapping her on a wait screen', async () => {
    const { getByTestId } = render(<PendingStatusHost />);
    await waitFor(() => expect(getByTestId('pending-status-application')).toBeTruthy());
    fireEvent.press(getByTestId('pending-status-application'));
    expect(mockPush).toHaveBeenCalledWith('/(auth)/application');
  });
});
