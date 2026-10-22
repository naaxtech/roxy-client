/**
 * Requests: message requests (CHAT-02) and friend requests in one sheet, two
 * segments. A stranger's message waits here — preview, "Not a friend" note,
 * Accept / Delete / Block — and never in the main list. Declining is quiet.
 */
import React from 'react';
import { ActivityIndicator } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../../lib/chat', () => ({
  ...jest.requireActual('../../../lib/chat'),
  respondMessageRequest: jest.fn().mockResolvedValue('active'),
}));

const mockAccept = jest.fn().mockResolvedValue(undefined);
const mockReject = jest.fn().mockResolvedValue(undefined);
const pendingReceived: any[] = [];
jest.mock('../../../store/friendStore', () => ({
  useFriendStore: (sel: (s: any) => unknown) => sel({
    pendingReceived,
    acceptRequest: mockAccept,
    rejectRequest: mockReject,
  }),
}));

const mockRefresh = jest.fn().mockResolvedValue(undefined);
const requests: any[] = [];
jest.mock('../../../store/connectStore', () => ({
  useConnectStore: (sel: (s: any) => unknown) => sel({ requests, refresh: mockRefresh }),
}));

const mockBlock = jest.fn().mockResolvedValue(undefined);
const mockOpenReport = jest.fn();
jest.mock('../../../store/safetyStore', () => ({
  useSafetyStore: (sel: (s: any) => unknown) => sel({ blockUser: mockBlock, openReportModal: mockOpenReport }),
}));
jest.mock('../../../lib/confirm', () => ({ confirmAction: jest.fn().mockResolvedValue(true), showAlert: jest.fn() }));
// Community invites (CHAT-09) share the Friends tab; none here.
jest.mock('../../../store/authStore', () => ({
  useAuthStore: (sel?: (s: object) => unknown) => {
    const state = { user: { id: 'me' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../../store/communityStore', () => ({
  useCommunityStore: (sel: (s: any) => unknown) => sel({ fetchJoined: jest.fn() }),
}));
jest.mock('../../../lib/communityMembership', () => ({
  fetchMyCommunityInvites: jest.fn().mockResolvedValue([]),
  respondCommunityInvite: jest.fn(),
}));

import { RequestsSheet } from '../../../components/messages/RequestsSheet';

const chat = jest.requireMock('../../../lib/chat');

const aRequest = {
  conversation_id: 'conv-r',
  conversation_type: 'direct',
  my_status: 'request',
  last_message: { id: 'm1', sender_id: 'stranger', message_type: 'text', content: 'hey, loved your post', deleted: false, created_at: '2026-01-01T00:00:00Z', is_read: false },
  members: [{ id: 'stranger', display_name: 'Sam', username: 'sam', avatar_url: null, last_seen_at: null, status: 'active', role: 'member' }],
  unread: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  pendingReceived.length = 0;
  requests.length = 0;
});

describe('RequestsSheet', () => {
  it('opens on message requests and shows the preview with a not-a-friend note', () => {
    requests.push(aRequest);
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={jest.fn()} />);
    expect(view.getByTestId('requests-tab-messages')).toBeTruthy();
    expect(view.getByText('Sam')).toBeTruthy();
    expect(view.getByText('hey, loved your post')).toBeTruthy();
    expect(view.getByText(/not on your friends list/i)).toBeTruthy();
  });

  it('Accept moves the thread into her chats and opens it', async () => {
    requests.push(aRequest);
    const onOpenChat = jest.fn();
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={onOpenChat} />);
    fireEvent.press(view.getByTestId('message-request-accept-conv-r'));
    await waitFor(() => expect(chat.respondMessageRequest).toHaveBeenCalledWith('conv-r', true));
    expect(mockRefresh).toHaveBeenCalled();
    expect(onOpenChat).toHaveBeenCalledWith('conv-r');
  });

  it('Delete declines quietly — she is never told', async () => {
    requests.push(aRequest);
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={jest.fn()} />);
    fireEvent.press(view.getByTestId('message-request-delete-conv-r'));
    await waitFor(() => expect(chat.respondMessageRequest).toHaveBeenCalledWith('conv-r', false));
  });

  it('Block declines AND blocks the sender', async () => {
    requests.push(aRequest);
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={jest.fn()} />);
    fireEvent.press(view.getByTestId('message-request-block-conv-r'));
    await waitFor(() => expect(mockBlock).toHaveBeenCalledWith('stranger'));
    expect(chat.respondMessageRequest).toHaveBeenCalledWith('conv-r', false);
  });

  it('Report hands the conversation to the one report sheet', () => {
    requests.push(aRequest);
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={jest.fn()} />);
    fireEvent.press(view.getByTestId('message-request-report-conv-r'));
    expect(mockOpenReport).toHaveBeenCalledWith({ userId: 'stranger', contentType: 'message', contentId: 'm1' });
  });

  it('the Friends segment still accepts and declines friend requests', async () => {
    pendingReceived.push({ id: 'f1', requester_id: 'u2', addressee_id: 'me', status: 'pending', created_at: '', profile: { id: 'u2', display_name: 'Bea', username: 'bea' } });
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={jest.fn()} />);
    fireEvent.press(view.getByTestId('requests-tab-friends'));
    fireEvent.press(view.getByTestId('request-accept-f1'));
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith('f1'));
  });

  it('a refusal is shown, never swallowed', async () => {
    requests.push(aRequest);
    chat.respondMessageRequest.mockRejectedValueOnce(new Error("Chat opens once you're an approved member."));
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={jest.fn()} />);
    fireEvent.press(view.getByTestId('message-request-accept-conv-r'));
    expect(await view.findByText("Chat opens once you're an approved member.")).toBeTruthy();
  });

  it('empty message requests explain what will land here', () => {
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={jest.fn()} />);
    expect(view.getByTestId('requests-empty')).toBeTruthy();
  });
});

/**
 * F10: an answer changes the sheet in the same frame as the tap. The card
 * leaves at once (no spinner in its place); a refused answer brings it back
 * with a snackbar that offers Retry.
 */
describe('RequestsSheet answers at once (F10)', () => {
  const NEVER = () => new Promise<never>(() => undefined);

  it('a message request leaves the list the moment she taps Delete, with no spinner', () => {
    requests.push(aRequest);
    chat.respondMessageRequest.mockImplementationOnce(NEVER);
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={jest.fn()} />);
    fireEvent.press(view.getByTestId('message-request-delete-conv-r'));
    expect(view.queryByTestId('message-request-conv-r')).toBeNull();
    expect(view.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('a refused message answer brings the card back and offers Retry', async () => {
    requests.push(aRequest);
    chat.respondMessageRequest.mockRejectedValueOnce(new Error("Chat opens once you're an approved member."));
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={jest.fn()} />);
    fireEvent.press(view.getByTestId('message-request-delete-conv-r'));
    await waitFor(() => expect(view.getByTestId('requests-snackbar')).toBeTruthy());
    expect(view.getByTestId('message-request-conv-r')).toBeTruthy();
    fireEvent.press(view.getByTestId('requests-snackbar-action'));
    await waitFor(() => expect(chat.respondMessageRequest).toHaveBeenCalledTimes(2));
  });

  it('accepting a friend shows no spinner while the store writes', () => {
    pendingReceived.push({ id: 'f1', requester_id: 'u2', addressee_id: 'me', status: 'pending', created_at: '', profile: { id: 'u2', display_name: 'Bea', username: 'bea' } });
    mockAccept.mockImplementationOnce(NEVER);
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={jest.fn()} />);
    fireEvent.press(view.getByTestId('requests-tab-friends'));
    fireEvent.press(view.getByTestId('request-accept-f1'));
    expect(view.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('a refused friend answer says so with Retry, which asks the store again', async () => {
    pendingReceived.push({ id: 'f1', requester_id: 'u2', addressee_id: 'me', status: 'pending', created_at: '', profile: { id: 'u2', display_name: 'Bea', username: 'bea' } });
    mockAccept.mockRejectedValueOnce(new Error('refused'));
    const view = render(<RequestsSheet visible onClose={jest.fn()} onOpenChat={jest.fn()} />);
    fireEvent.press(view.getByTestId('requests-tab-friends'));
    fireEvent.press(view.getByTestId('request-accept-f1'));
    await waitFor(() => expect(view.getByText('Could not accept that just now.')).toBeTruthy());
    fireEvent.press(view.getByTestId('requests-snackbar-action'));
    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(2));
  });
});
