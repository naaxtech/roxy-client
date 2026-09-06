import type { ComponentProps } from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { YouMoreMenu } from '../../components/profile/YouMoreMenu';
import { supabase } from '../../lib/supabase';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const from = supabase.from as jest.Mock;

const noBusinesses = () => ({
  select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
});

beforeEach(() => {
  mockPush.mockReset();
  from.mockReset();
  from.mockImplementation(noBusinesses);
});

const open = (over: Partial<ComponentProps<typeof YouMoreMenu>> = {}) => {
  const onClose = jest.fn();
  const onOpenSaved = jest.fn();
  const view = render(
    <YouMoreMenu
      visible
      onClose={onClose}
      onOpenSaved={onOpenSaved}
      walletCount={2}
      savedCount={4}
      {...over}
    />,
  );
  return { view, onClose, onOpenSaved };
};

describe('You More menu — destinations live here, not on the profile', () => {
  it('groups the extra doors so the You tab can stay a profile', async () => {
    const { view } = open();
    expect(view.getByTestId('you-more-menu')).toBeTruthy();
    expect(view.getByText('Your stuff')).toBeTruthy();
    expect(view.getByText('Create')).toBeTruthy();
    expect(view.getByText('Account')).toBeTruthy();
    await waitFor(() => expect(view.getByTestId('you-people')).toBeTruthy());
    expect(view.getByTestId('you-wallet')).toBeTruthy();
    expect(view.getByTestId('you-badges')).toBeTruthy();
    expect(view.getByTestId('you-saved')).toBeTruthy();
    expect(view.getByTestId('you-sell')).toBeTruthy();
    expect(view.getByTestId('you-settings')).toBeTruthy();
  });

  it('reaches My people and closes the menu first', async () => {
    const { view, onClose } = open();
    await waitFor(() => expect(view.getByTestId('you-people')).toBeTruthy());
    fireEvent.press(view.getByTestId('you-people'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/people');
  });

  it('reaches Badges', async () => {
    const { view } = open();
    await waitFor(() => expect(view.getByTestId('you-badges')).toBeTruthy());
    fireEvent.press(view.getByTestId('you-badges'));
    expect(mockPush).toHaveBeenCalledWith('/badges');
  });

  it('reaches the ticket wallet', async () => {
    const { view } = open();
    await waitFor(() => expect(view.getByTestId('you-wallet')).toBeTruthy());
    fireEvent.press(view.getByTestId('you-wallet'));
    expect(mockPush).toHaveBeenCalledWith('/tickets');
  });

  it('opens Saved in place and never navigates away', async () => {
    const { view, onOpenSaved } = open();
    await waitFor(() => expect(view.getByTestId('you-saved')).toBeTruthy());
    fireEvent.press(view.getByTestId('you-saved'));
    expect(onOpenSaved).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('reaches Settings from Account, not from the cover', async () => {
    const { view } = open();
    fireEvent.press(view.getByTestId('you-settings'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/you/settings');
  });

  it('every row is a labelled button', async () => {
    const { view } = open();
    await waitFor(() => expect(view.getByTestId('you-people')).toBeTruthy());
    for (const id of ['you-people', 'you-wallet', 'you-badges', 'you-saved', 'you-sell', 'you-settings']) {
      const row = view.getByTestId(id);
      expect(row.props.accessibilityRole).toBe('button');
      expect(String(row.props.accessibilityLabel ?? '').length).toBeGreaterThan(0);
    }
  });
});
