import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

/**
 * Community invites and join requests (migration 135) land in the in-app list
 * with their own icon, and a tap opens where she acts on them.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
// Focus = mount: the screen loads (and re-loads) on focus.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../../store/authStore', () => {
  const state = { user: { id: 'u1' } };
  return { useAuthStore: () => state };
});
jest.mock('../../hooks/useAccess', () => ({ useAccess: () => ({ can: () => true }) }));
jest.mock('../../lib/notifications', () => ({
  fetchNotificationsResult: jest.fn(() => Promise.resolve({ ok: true, items: [
    { id: 'n1', type: 'community_invite', title: 'Maya invited you to Book Club', body: 'Join or say not now in Requests',
      link_path: '/messages?requests=1&community=c9', created_at: new Date().toISOString(), read_at: null, archived_at: null },
    { id: 'n2', type: 'community_join_request', title: 'Bea asked to join Book Club', body: 'Answer it in Members',
      link_path: '/community/members/c9', created_at: new Date().toISOString(), read_at: null, archived_at: null },
  ] })),
  fetchArchivedNotifications: jest.fn(() => Promise.resolve({ ok: true, items: [] })),
  clearNotifications: jest.fn(() => Promise.resolve({ ok: true, cleared: [] })),
  clearNotificationsUpTo: jest.fn(() => Promise.resolve({ ok: true, cleared: [] })),
  restoreNotifications: jest.fn(() => Promise.resolve({ ok: true, restored: 0 })),
  markNotificationRead: jest.fn(() => Promise.resolve()),
  markAllNotificationsRead: jest.fn(() => Promise.resolve()),
  countUnread: (l: { read_at: string | null }[]) => l.filter((n) => n.read_at === null).length,
}));

// eslint-disable-next-line import/first
import NotificationsScreen from '../../app/notifications';

beforeEach(() => mockPush.mockClear());

it('an invite has its own icon and opens Requests', async () => {
  const v = render(<NotificationsScreen />);
  const row = await v.findByLabelText('Maya invited you to Book Club');
  expect(v.getByText('🔐')).toBeTruthy();
  fireEvent.press(row);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/messages?requests=1&community=c9'));
});

it('a join request has its own icon and opens Members', async () => {
  const v = render(<NotificationsScreen />);
  const row = await v.findByLabelText('Bea asked to join Book Club');
  expect(v.getByText('🚪')).toBeTruthy();
  fireEvent.press(row);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/community/members/c9'));
});
