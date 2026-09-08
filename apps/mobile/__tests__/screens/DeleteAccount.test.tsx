import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('../../lib/supabase', () => ({
  callEdgeFunction: jest.fn().mockResolvedValue({ data: null, error: null }),
  supabase: { auth: { signOut: jest.fn().mockResolvedValue({}) } },
}));

jest.mock('../../store/authStore', () => ({
  useAuthStore: {
    getState: jest.fn(() => ({ signOut: jest.fn() })),
  },
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ replace: mockReplace, push: jest.fn() })),
}));

// Mock safe-area-context
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

import DeleteAccountScreen from '../../app/(tabs)/you/delete-account';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DeleteAccountScreen', () => {
  it('renders warning text about 30-day deletion', () => {
    const { getByText } = render(<DeleteAccountScreen />);
    expect(getByText(/30 days/i)).toBeTruthy();
  });

  it('confirm button is disabled when input is empty', () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    const button = getByTestId('delete-confirm-button');
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it('confirm button is disabled when input is lowercase "delete"', () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    const input = getByTestId('delete-input');
    fireEvent.changeText(input, 'delete');
    const button = getByTestId('delete-confirm-button');
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it('confirm button is enabled when input is "DELETE"', () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    const input = getByTestId('delete-input');
    fireEvent.changeText(input, 'DELETE');
    const button = getByTestId('delete-confirm-button');
    expect(button.props.accessibilityState?.disabled).toBe(false);
  });

  it('calls callEdgeFunction with gdpr-delete on confirm', async () => {
    const { callEdgeFunction } = jest.requireMock('../../lib/supabase') as any;
    const { getByTestId } = render(<DeleteAccountScreen />);
    const input = getByTestId('delete-input');
    fireEvent.changeText(input, 'DELETE');
    const button = getByTestId('delete-confirm-button');
    await act(async () => {
      fireEvent.press(button);
    });
    expect(callEdgeFunction).toHaveBeenCalledWith('gdpr-delete', {});
  });
});
