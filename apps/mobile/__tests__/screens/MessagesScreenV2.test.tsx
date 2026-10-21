import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

/**
 * Messages, v2 normal state (board v2-06): a headline, search and compose in
 * the header, Roxy AI and Sister pinned, then a Requests row that says how
 * many are waiting and opens the Requests sheet. No caps chip, no discreet
 * switch (held with Premium), no dead buttons.
 */

const mockPush = jest.fn();
const mockState = {
  requests: [{ id: 'r1' }, { id: 'r2' }] as unknown[],
  pendingCount: 0,
};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), setParams: jest.fn() }),
  usePathname: () => '/messages',
  useLocalSearchParams: () => ({}),
}));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../../store/authStore', () => ({ useAuthStore: () => ({ user: { id: 'u1' } }) }));
// Stable references: the screen's effects depend on `threads`, and a fresh []
// on every render would loop them.
const mockThreads: unknown[] = [];
const mockRefresh = jest.fn();
const mockFetchAll = jest.fn();
jest.mock('../../store/connectStore', () => ({
  useConnectStore: (sel: (s: object) => unknown) =>
    sel({ threads: mockThreads, requests: mockState.requests, loaded: true, loading: false, refresh: mockRefresh }),
}));
jest.mock('../../store/friendStore', () => ({
  useFriendStore: (sel: (s: object) => unknown) => sel({ pendingCount: mockState.pendingCount, fetchAll: mockFetchAll }),
  isOnline: () => false,
}));
jest.mock('../../store/communityStore', () => {
  const state = { joinedCommunities: [], hydrate: jest.fn() };
  return { useCommunityStore: (sel: (s: typeof state) => unknown) => sel(state) };
});
jest.mock('../../store/profileStore', () => {
  const state = { profile: null };
  return { useProfileStore: (sel: (s: typeof state) => unknown) => sel(state) };
});
jest.mock('../../hooks/useAccess', () => ({ useAccess: () => ({ can: () => true }) }));
jest.mock('../../components/messages/OfficialChatInbox', () => ({ OfficialChatInbox: () => null }));
jest.mock('../../components/messages/MessagesInbox', () => {
  const { View } = jest.requireActual('react-native');
  return {
    MessagesInbox: ({ directHeader, footer }: { directHeader?: React.ReactNode; footer?: React.ReactNode }) => (
      <View testID="inbox-stub">{directHeader}{footer}</View>
    ),
  };
});
jest.mock('../../components/messages/RequestsSheet', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    RequestsSheet: ({ visible }: { visible: boolean }) => (
      <Text testID="requests-sheet">{visible ? 'open' : 'closed'}</Text>
    ),
  };
});
jest.mock('../../lib/inboxCommunities', () => ({
  fetchInboxCommunityMeta: jest.fn(() => Promise.resolve({})),
  fetchCommunityUnread: jest.fn(() => Promise.resolve({})),
  filterInboxByQuery: (x: unknown[]) => x,
  inboxCommunityFromJoined: (x: unknown) => x,
}));

// eslint-disable-next-line import/first
import MessagesRoute from '../../app/(tabs)/messages/index';

beforeEach(() => {
  mockPush.mockClear();
  mockState.requests = [{ id: 'r1' }, { id: 'r2' }];
  mockState.pendingCount = 0;
});

describe('Messages — v2 normal state', () => {
  it('has a Messages headline and no caps Requests chip in the header', () => {
    const v = render(<MessagesRoute />);
    expect(v.getByText('Messages')).toBeTruthy();
    expect(v.queryByText('DIRECT')).toBeNull();
    expect(v.getByTestId('messages-new')).toBeTruthy();
    expect(v.getByTestId('messages-search-toggle')).toBeTruthy();
  });

  it('pins Roxy AI above Sister', () => {
    const v = render(<MessagesRoute />);
    const tree = JSON.stringify(v.toJSON());
    expect(tree.indexOf('persona-row-roxy')).toBeGreaterThan(-1);
    expect(tree.indexOf('persona-row-roxy')).toBeLessThan(tree.indexOf('persona-row-sister'));
    fireEvent.press(v.getByTestId('persona-row-roxy'));
    expect(mockPush).toHaveBeenCalledWith('/roxy-chat');
  });

  it('says how many requests are waiting and opens the Requests sheet', () => {
    const v = render(<MessagesRoute />);
    const row = v.getByTestId('messages-requests-entry');
    expect(v.getByText('2 waiting')).toBeTruthy();
    expect(String(row.props.accessibilityLabel)).toBe('Requests, 2 waiting');
    expect(v.getByTestId('requests-sheet').props.children).toBe('closed');
    fireEvent.press(row);
    expect(v.getByTestId('requests-sheet').props.children).toBe('open');
  });

  it('keeps the Requests row when nothing waits, and says so', () => {
    mockState.requests = [];
    const v = render(<MessagesRoute />);
    expect(v.getByTestId('messages-requests-entry')).toBeTruthy();
    expect(v.getByText('None waiting')).toBeTruthy();
  });

  it('opens search from the header instead of a permanent field', () => {
    const v = render(<MessagesRoute />);
    expect(v.queryByTestId('messages-search')).toBeNull();
    fireEvent.press(v.getByTestId('messages-search-toggle'));
    expect(v.getByTestId('messages-search')).toBeTruthy();
  });

  it('compose starts a new message', () => {
    const v = render(<MessagesRoute />);
    fireEvent.press(v.getByTestId('messages-new'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/messages/new');
  });
});
