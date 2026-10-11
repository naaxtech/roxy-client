import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('../../lib/supabase', () => ({
  callEdgeFunction: jest.fn().mockResolvedValue({ data: null, error: null }),
  supabase: { auth: { signOut: jest.fn().mockResolvedValue({}) } },
}));

jest.mock('../../store/resetAllStores', () => ({ resetAllStores: jest.fn() }));
jest.mock('../../lib/dataExport', () => ({
  exportUserData: jest.fn().mockResolvedValue({ status: 'shared', fileName: 'roxy.json' }),
  describeExportResult: jest.fn(() => ({ title: 'Your data is ready', body: 'ok' })),
}));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn(), confirmAction: jest.fn() }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

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
  it('says what happens now and what happens within 30 days — only what the server does', () => {
    const { getByText } = render(<DeleteAccountScreen />);
    expect(getByText(/right away, your name, photo, bio and pronouns are removed/i)).toBeTruthy();
    expect(getByText(/within 30 days, everything else is permanently deleted/i)).toBeTruthy();
  });

  it('offers to download her data before she goes', async () => {
    const { exportUserData } = jest.requireMock('../../lib/dataExport') as { exportUserData: jest.Mock };
    const { showAlert } = jest.requireMock('../../lib/confirm') as { showAlert: jest.Mock };
    const { getByTestId } = render(<DeleteAccountScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('delete-export-button'));
    });
    expect(exportUserData).toHaveBeenCalled();
    expect(showAlert).toHaveBeenCalledWith('Your data is ready', 'ok');
  });

  it('after the server confirms, every per-user store on this phone is reset', async () => {
    const { resetAllStores } = jest.requireMock('../../store/resetAllStores') as { resetAllStores: jest.Mock };
    const { getByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-input'), 'DELETE');
    await act(async () => {
      fireEvent.press(getByTestId('delete-confirm-button'));
    });
    expect(resetAllStores).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/welcome');
  });

  it('a failure keeps her signed in and does not leak the raw server error', async () => {
    const { callEdgeFunction } = jest.requireMock('../../lib/supabase') as { callEdgeFunction: jest.Mock };
    const { showAlert } = jest.requireMock('../../lib/confirm') as { showAlert: jest.Mock };
    const { resetAllStores } = jest.requireMock('../../store/resetAllStores') as { resetAllStores: jest.Mock };
    callEdgeFunction.mockResolvedValueOnce({ data: null, error: 'relation "push_tokens" does not exist' });
    const { getByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-input'), 'DELETE');
    await act(async () => {
      fireEvent.press(getByTestId('delete-confirm-button'));
    });
    expect(resetAllStores).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    const [, body] = showAlert.mock.calls[0];
    expect(body).toMatch(/nothing has been removed/);
    expect(body).not.toMatch(/push_tokens/);
  });

  it('typing "delete " with a trailing space still confirms', () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-input'), 'DELETE ');
    expect(getByTestId('delete-confirm-button').props.accessibilityState?.disabled).toBe(false);
  });

  it('confirm button is disabled when input is empty', () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    const button = getByTestId('delete-confirm-button');
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it('confirm button is disabled for anything that is not the word', () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    const input = getByTestId('delete-input');
    fireEvent.changeText(input, 'delet');
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
