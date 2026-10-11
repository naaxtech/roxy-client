/**
 * You › Settings › Notifications — the screen behind Nicole's rule:
 * every type on by default, she chooses; previews off unless she turns them on.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import NotificationSettingsScreen from '../../app/(tabs)/you/notification-settings';

const mockLoad = jest.fn();
const mockSave = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1' } }),
}));
jest.mock('../../lib/notificationSettings', () => {
  const actual = jest.requireActual('../../lib/notificationSettings');
  return {
    ...actual,
    loadNotificationSettings: (...a: unknown[]) => mockLoad(...a),
    saveNotificationSettings: (...a: unknown[]) => mockSave(...a),
    deviceTimezone: () => 'Asia/Manila',
  };
});
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
}));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn() }));

const { DEFAULT_NOTIFICATION_SETTINGS } = jest.requireActual('../../lib/notificationSettings');

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue({ ...DEFAULT_NOTIFICATION_SETTINGS });
  mockSave.mockResolvedValue(undefined);
});

it('shows every type on and previews off for a woman who never changed anything', async () => {
  const v = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(v.getByTestId('notif-switch-messages')).toBeTruthy());
  for (const k of ['push_enabled', 'messages', 'friends', 'events', 'community_chats', 'membership']) {
    expect(v.getByTestId(`notif-switch-${k}`).props.value).toBe(true);
  }
  expect(v.getByTestId('notif-switch-show_previews').props.value).toBe(false);
});

it('turning message notifications off saves it, with her timezone', async () => {
  const v = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(v.getByTestId('notif-switch-messages')).toBeTruthy());
  fireEvent(v.getByTestId('notif-switch-messages'), 'valueChange', false);
  await waitFor(() => expect(mockSave).toHaveBeenCalledWith(
    'u1', expect.objectContaining({ messages: false }), 'Asia/Manila',
  ));
});

it('rolls the switch back and says so when the save fails', async () => {
  mockSave.mockRejectedValue(new Error('offline'));
  const v = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(v.getByTestId('notif-switch-messages')).toBeTruthy());
  fireEvent(v.getByTestId('notif-switch-messages'), 'valueChange', false);
  await waitFor(() => expect(v.getByTestId('notif-switch-messages').props.value).toBe(true));
  expect(v.getByTestId('notif-save-error')).toBeTruthy();
});

it('the master switch off disables the per-type switches', async () => {
  mockLoad.mockResolvedValue({ ...DEFAULT_NOTIFICATION_SETTINGS, push_enabled: false });
  const v = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(v.getByTestId('notif-switch-messages')).toBeTruthy());
  expect(v.getByTestId('notif-switch-messages').props.disabled).toBe(true);
});

it('says the settings could not load instead of showing switches it cannot trust', async () => {
  mockLoad.mockRejectedValue(new Error('down'));
  const v = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(v.getByTestId('notif-load-error')).toBeTruthy());
  expect(v.queryByTestId('notif-switch-messages')).toBeNull();
});

it('quiet hours: a preset turns them on, "Off" clears them', async () => {
  const v = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(v.getByTestId('notif-quiet-22-07')).toBeTruthy());
  fireEvent.press(v.getByTestId('notif-quiet-22-07'));
  await waitFor(() => expect(mockSave).toHaveBeenLastCalledWith(
    'u1', expect.objectContaining({ quiet_start: '22:00', quiet_end: '07:00' }), 'Asia/Manila',
  ));
  fireEvent.press(v.getByTestId('notif-quiet-off'));
  await waitFor(() => expect(mockSave).toHaveBeenLastCalledWith(
    'u1', expect.objectContaining({ quiet_start: null, quiet_end: null }), 'Asia/Manila',
  ));
});
