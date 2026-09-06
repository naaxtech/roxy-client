import { render, fireEvent, waitFor } from '@testing-library/react-native';
import NewMessageScreen from '../app/(tabs)/messages/new';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));
jest.mock('../lib/directMessages', () => ({
  openDirectChat: jest.fn().mockResolvedValue('conv-9'),
}));
jest.mock('../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'me' } }),
}));

const friends: any[] = [];
jest.mock('../store/friendStore', () => ({
  useFriendStore: () => ({ friends, fetchAll: jest.fn().mockResolvedValue(undefined) }),
  isOnline: () => false,
  sortByPresence: (f: any[]) => f,
}));

jest.mock('../hooks/useAccess', () => ({
  useAccess: () => ({
    tier: 'beta',
    isBeta: true,
    can: () => true,
    canCommunity: () => true,
  }),
}));

const { openDirectChat } = jest.requireMock('../lib/directMessages');

describe('NewMessageScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    friends.length = 0;
  });

  it('renders friends and opens a chat on tap', async () => {
    friends.push({
      id: 'f1',
      profile: { id: 'u1', display_name: 'Sam', username: 'sam', last_seen_at: null },
    });
    const { findByText } = render(<NewMessageScreen />);
    fireEvent.press(await findByText('Sam'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/chat/conv-9'));
    expect(openDirectChat).toHaveBeenCalledWith('me', 'u1');
  });

  it('shows empty state with communities CTA when no friends', async () => {
    const { getByText } = render(<NewMessageScreen />);
    await waitFor(() => expect(getByText(/Add friends in your communities/i)).toBeTruthy());
    fireEvent.press(getByText(/Find your communities/i));
    expect(mockPush).toHaveBeenCalledWith('/communities');
  });
});
