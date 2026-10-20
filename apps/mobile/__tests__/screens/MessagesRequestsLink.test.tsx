import React from 'react';
import { render } from '@testing-library/react-native';

/**
 * A community-invite notification (migration 135) opens
 * /messages?requests=1&community=<id>: the Messages inbox must open the
 * Requests sheet straight away, because that is where she answers the invite.
 */

const mockParams: { value: Record<string, string | undefined> } = { value: {} };
const mockSetParams = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), setParams: mockSetParams }),
  usePathname: () => '/messages',
  useLocalSearchParams: () => mockParams.value,
}));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../../store/authStore', () => ({ useAuthStore: () => ({ user: { id: 'u1' } }) }));
jest.mock('../../store/connectStore', () => {
  const state = { threads: [], requests: [], loaded: true, loading: false, refresh: jest.fn() };
  return { useConnectStore: (sel: (s: typeof state) => unknown) => sel(state) };
});
jest.mock('../../store/friendStore', () => {
  const state = { pendingCount: 0, fetchAll: jest.fn() };
  return { useFriendStore: (sel: (s: typeof state) => unknown) => sel(state), isOnline: () => false };
});
jest.mock('../../store/communityStore', () => {
  const state = { joinedCommunities: [], hydrate: jest.fn() };
  return { useCommunityStore: (sel: (s: typeof state) => unknown) => sel(state) };
});
jest.mock('../../store/profileStore', () => {
  const state = { profile: null };
  return { useProfileStore: (sel: (s: typeof state) => unknown) => sel(state) };
});
jest.mock('../../hooks/useAccess', () => ({ useAccess: () => ({ can: () => true }) }));
jest.mock('../../components/ui/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('../../components/messages/PinnedPersonaRow', () => ({ PinnedPersonaRow: () => null }));
jest.mock('../../components/messages/OfficialChatInbox', () => ({ OfficialChatInbox: () => null }));
jest.mock('../../components/messages/MessagesInbox', () => ({ MessagesInbox: () => null }));
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
  mockParams.value = {};
  mockSetParams.mockClear();
});

it('opens Requests at once when a community-invite notification brought her here', () => {
  mockParams.value = { requests: '1', community: 'c9' };
  const v = render(<MessagesRoute />);
  expect(v.getByTestId('requests-sheet').props.children).toBe('open');
  // The param is spent, so going back to Messages later does not reopen it.
  expect(mockSetParams).toHaveBeenCalledWith({ requests: undefined, community: undefined });
});

it('a plain visit to Messages keeps Requests closed', () => {
  const v = render(<MessagesRoute />);
  expect(v.getByTestId('requests-sheet').props.children).toBe('closed');
  expect(mockSetParams).not.toHaveBeenCalled();
});
