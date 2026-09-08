import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ViewAsPicker } from '../../../components/settings/ViewAsPicker';
import { useProfileStore } from '../../../store/profileStore';
import { useViewAsStore } from '../../../store/viewAsStore';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}));

beforeEach(() => {
  mockReplace.mockClear();
  useViewAsStore.setState({ preview: null });
  useProfileStore.setState({
    profile: {
      staff_role: 'core',
      is_staff: true,
      vetting_status: 'approved',
      access_tier: 'beta',
    } as never,
  });
});

describe('ViewAsPicker', () => {
  it('is hidden unless the signed-in account is Roxy core', () => {
    useProfileStore.setState({
      profile: { staff_role: 'staff', is_staff: true, vetting_status: 'approved' } as never,
    });
    const { queryByTestId } = render(<ViewAsPicker />);
    expect(queryByTestId('view-as-picker')).toBeNull();
  });

  it('lets core preview each live account type without writing the profile', () => {
    const { getByTestId } = render(<ViewAsPicker />);
    expect(getByTestId('view-as-picker')).toBeTruthy();
    fireEvent.press(getByTestId('view-as-trigger'));
    fireEvent.press(getByTestId('view-as-member'));
    expect(useViewAsStore.getState().preview).toBe('member');
    expect(useProfileStore.getState().profile?.staff_role).toBe('core');
  });

  it('keeps pending preview in the app, not on the wait screen', () => {
    const { getByTestId } = render(<ViewAsPicker />);
    fireEvent.press(getByTestId('view-as-trigger'));
    fireEvent.press(getByTestId('view-as-pending'));
    expect(useViewAsStore.getState().preview).toBe('pending');
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/feed');
    expect(mockReplace).not.toHaveBeenCalledWith('/(auth)/pending');
  });
});
