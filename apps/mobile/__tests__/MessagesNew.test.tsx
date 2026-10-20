import { render, fireEvent, waitFor } from '@testing-library/react-native';
import NewMessageScreen from '../app/(tabs)/messages/new';

/**
 * New message: pick one friend for a 1:1, two or more for a private group.
 *
 * One person keeps the old one-tap feel (tap → chat). A second pick turns the
 * screen into a group builder: chips of who's in, an optional name and emoji,
 * and "Create group" — which goes through create_group (migration 132), so
 * the friendship / block / allow-adds / cap rules are the server's, and its
 * refusal is shown in words.
 */
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
}));
jest.mock('../lib/directMessages', () => ({
  openDirectChat: jest.fn().mockResolvedValue('conv-9'),
}));
jest.mock('../lib/chat', () => ({
  ...jest.requireActual('../lib/chat'),
  createGroup: jest.fn().mockResolvedValue('group-1'),
}));
jest.mock('../lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../lib/confirm', () => ({ showAlert: jest.fn() }));
jest.mock('../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'me' } }),
}));
jest.mock('../store/connectStore', () => ({
  useConnectStore: (sel: (s: any) => unknown) => sel({ refresh: jest.fn() }),
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
const chat = jest.requireMock('../lib/chat');
const { showAlert } = jest.requireMock('../lib/confirm');

const friend = (id: string, name: string) => ({
  id: `f-${id}`,
  profile: { id, display_name: name, username: name.toLowerCase(), last_seen_at: null },
});

describe('NewMessageScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    friends.length = 0;
  });

  it('one friend picked → Chat opens the 1:1', async () => {
    friends.push(friend('u1', 'Sam'));
    const view = render(<NewMessageScreen />);
    fireEvent.press(await view.findByText('Sam'));
    fireEvent.press(view.getByTestId('new-message-go'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/chat/conv-9'));
    expect(openDirectChat).toHaveBeenCalledWith('me', 'u1');
    expect(chat.createGroup).not.toHaveBeenCalled();
  });

  it('two friends picked → group builder with name + emoji → create_group', async () => {
    friends.push(friend('u1', 'Sam'), friend('u2', 'Bea'));
    const view = render(<NewMessageScreen />);
    fireEvent.press(await view.findByText('Sam'));
    fireEvent.press(view.getByText('Bea'));
    expect(view.getByTestId('group-builder')).toBeTruthy();
    fireEvent.changeText(view.getByTestId('group-name'), '  Weekend crew  ');
    fireEvent.press(view.getByTestId('group-emoji-🌈'));
    fireEvent.press(view.getByTestId('new-message-go'));
    await waitFor(() => expect(chat.createGroup).toHaveBeenCalledWith('Weekend crew', ['u1', 'u2'], '🌈'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/chat/group-1'));
  });

  it('tapping a picked friend again unpicks her', async () => {
    friends.push(friend('u1', 'Sam'), friend('u2', 'Bea'));
    const view = render(<NewMessageScreen />);
    fireEvent.press(await view.findByText('Sam'));
    fireEvent.press(view.getByText('Bea'));
    fireEvent.press(view.getByTestId('friend-u2'));
    expect(view.queryByTestId('group-builder')).toBeNull();
  });

  it('a group with no name is fine — the server names it by its members', async () => {
    friends.push(friend('u1', 'Sam'), friend('u2', 'Bea'));
    const view = render(<NewMessageScreen />);
    fireEvent.press(await view.findByText('Sam'));
    fireEvent.press(view.getByText('Bea'));
    fireEvent.press(view.getByTestId('new-message-go'));
    await waitFor(() => expect(chat.createGroup).toHaveBeenCalledWith(null, ['u1', 'u2'], null));
  });

  it('a refusal from the server is shown in words', async () => {
    friends.push(friend('u1', 'Sam'), friend('u2', 'Bea'));
    chat.createGroup.mockRejectedValueOnce(new Error("Bea doesn't take group adds."));
    const view = render(<NewMessageScreen />);
    fireEvent.press(await view.findByText('Sam'));
    fireEvent.press(view.getByText('Bea'));
    fireEvent.press(view.getByTestId('new-message-go'));
    await waitFor(() => expect(showAlert).toHaveBeenCalledWith("Couldn't start that chat", "Bea doesn't take group adds."));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('search narrows the friend list', async () => {
    friends.push(friend('u1', 'Sam'), friend('u2', 'Bea'));
    const view = render(<NewMessageScreen />);
    await view.findByText('Sam');
    fireEvent.changeText(view.getByTestId('new-message-search'), 'be');
    expect(view.queryByText('Sam')).toBeNull();
    expect(view.getByText('Bea')).toBeTruthy();
  });

  it('shows empty state with communities CTA when no friends', async () => {
    const { getByText } = render(<NewMessageScreen />);
    await waitFor(() => expect(getByText(/Add friends in your communities/i)).toBeTruthy());
    fireEvent.press(getByText(/Find your communities/i));
    expect(mockPush).toHaveBeenCalledWith('/communities');
  });
});
