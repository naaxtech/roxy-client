import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import GroupInfoScreen from '../../app/chat/info/[id]';

/**
 * Group info: who is in the group and what she can do about it.
 *
 * Every action goes through a 132 RPC wrapper in lib/chat, and every refusal
 * is shown in the words lib/chat already chose. Buttons appear only for the
 * roles the server would accept, so a member never sees "Remove".
 */
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace, canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'g1' }),
}));
jest.mock('../../lib/chat', () => ({
  ...jest.requireActual('../../lib/chat'),
  addGroupMembers: jest.fn().mockResolvedValue(1),
  removeGroupMember: jest.fn().mockResolvedValue(undefined),
  leaveGroup: jest.fn().mockResolvedValue(undefined),
  renameGroup: jest.fn().mockResolvedValue(undefined),
  setGroupRole: jest.fn().mockResolvedValue(undefined),
  muteConversation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/confirm', () => ({
  showAlert: jest.fn().mockResolvedValue(undefined),
  confirmAction: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'me' } }),
}));
jest.mock('../../store/connectStore', () => ({
  useConnectStore: (sel: (s: any) => unknown) => sel({ refresh: jest.fn() }),
}));
const mockFriends: any[] = [];
jest.mock('../../store/friendStore', () => ({
  useFriendStore: () => ({ friends: mockFriends, fetchAll: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({ tier: 'beta', isBeta: true, can: () => true, canCommunity: () => true }),
}));
const mockReload = jest.fn();
const mockOpenReport = jest.fn();
jest.mock('../../store/safetyStore', () => ({
  useSafetyStore: (sel: (s: any) => unknown) => sel({ openReportModal: (...a: unknown[]) => mockOpenReport(...a) }),
}));
const mockThread: { meta: any; loading: boolean; unavailable: boolean } = { meta: null, loading: false, unavailable: false };
jest.mock('../../hooks/useThreadMeta', () => ({
  useThreadMeta: () => ({ ...mockThread, reload: mockReload }),
}));

const chat = jest.requireMock('../../lib/chat');
const { showAlert, confirmAction } = jest.requireMock('../../lib/confirm');

const m = (id: string, name: string, role = 'member', status = 'active', muted_until: string | null = null) => ({
  id, display_name: name, username: name.toLowerCase(), avatar_url: null, last_seen_at: null,
  role, status, joined_at: `2026-01-01T00:00:0${id.length}Z`, muted_until,
});

function group(myRole: 'owner' | 'admin' | 'member', others = [m('ana', 'Ana', 'admin'), m('bea', 'Bea')], mutedUntil: string | null = null) {
  mockThread.meta = {
    id: 'g1', type: 'group', title: 'Weekend crew', emoji: '🌈', createdBy: 'me',
    me: m('me', 'Me', myRole, 'active', mutedUntil), others,
  };
}

const friend = (id: string, name: string) => ({ id: `f-${id}`, profile: { id, display_name: name, username: name.toLowerCase() } });

beforeEach(() => {
  jest.clearAllMocks();
  mockFriends.length = 0;
  mockThread.loading = false;
  mockThread.unavailable = false;
  group('owner');
});

describe('Group info', () => {
  it('shows the group, how many are in it, and each member with her role', () => {
    const view = render(<GroupInfoScreen />);
    expect(view.getByText('Weekend crew')).toBeTruthy();
    expect(view.getByText('3 of 32 people')).toBeTruthy();
    expect(view.getByTestId('member-me')).toBeTruthy();
    expect(view.getByTestId('member-ana')).toBeTruthy();
    expect(view.getByTestId('member-bea')).toBeTruthy();
    expect(view.getByText('Admin')).toBeTruthy();
    expect(view.getByText('Owner')).toBeTruthy();
  });

  it('a member sees no remove, role or rename controls', () => {
    group('member', [m('ana', 'Ana', 'owner'), m('bea', 'Bea')]);
    const view = render(<GroupInfoScreen />);
    expect(view.queryByTestId('remove-bea')).toBeNull();
    expect(view.queryByTestId('role-bea')).toBeNull();
    expect(view.queryByTestId('group-edit')).toBeNull();
    // ...but can still add friends, mute and leave.
    expect(view.getByTestId('group-add')).toBeTruthy();
    expect(view.getByTestId('group-mute')).toBeTruthy();
    expect(view.getByTestId('group-leave')).toBeTruthy();
  });

  it('an admin can remove a member but not another admin', () => {
    group('admin', [m('ana', 'Ana', 'owner'), m('bea', 'Bea'), m('cat', 'Cat', 'admin')]);
    const view = render(<GroupInfoScreen />);
    expect(view.getByTestId('remove-bea')).toBeTruthy();
    expect(view.queryByTestId('remove-cat')).toBeNull();
    expect(view.queryByTestId('remove-ana')).toBeNull();
    expect(view.queryByTestId('role-bea')).toBeNull();
  });

  it('remove asks first, then calls remove_group_member', async () => {
    const view = render(<GroupInfoScreen />);
    fireEvent.press(view.getByTestId('remove-bea'));
    await waitFor(() => expect(chat.removeGroupMember).toHaveBeenCalledWith('g1', 'bea'));
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining('Bea'), expect.any(String), 'Remove');
    expect(mockReload).toHaveBeenCalled();
  });

  it('saying no to the remove prompt removes nobody', async () => {
    confirmAction.mockResolvedValueOnce(false);
    const view = render(<GroupInfoScreen />);
    fireEvent.press(view.getByTestId('remove-bea'));
    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(chat.removeGroupMember).not.toHaveBeenCalled();
  });

  it('the owner makes a member admin and an admin a member', async () => {
    const view = render(<GroupInfoScreen />);
    fireEvent.press(view.getByTestId('role-bea'));
    await waitFor(() => expect(chat.setGroupRole).toHaveBeenCalledWith('g1', 'bea', 'admin'));
    fireEvent.press(view.getByTestId('role-ana'));
    await waitFor(() => expect(chat.setGroupRole).toHaveBeenCalledWith('g1', 'ana', 'member'));
  });

  it('rename saves the trimmed name and the chosen emoji', async () => {
    const view = render(<GroupInfoScreen />);
    fireEvent.press(view.getByTestId('group-edit'));
    fireEvent.changeText(view.getByTestId('group-name-input'), '  Book club  ');
    fireEvent.press(view.getByTestId('group-emoji-📚'));
    fireEvent.press(view.getByTestId('group-save'));
    await waitFor(() => expect(chat.renameGroup).toHaveBeenCalledWith('g1', 'Book club', '📚'));
  });

  it('group admin actions never buzz (motion spec §3.3)', async () => {
    const { haptic } = jest.requireMock('../../lib/haptics') as { haptic: jest.Mock };
    haptic.mockClear();
    const view = render(<GroupInfoScreen />);
    fireEvent.press(view.getByTestId('role-bea'));
    await waitFor(() => expect(chat.setGroupRole).toHaveBeenCalled());
    fireEvent.press(view.getByTestId('group-edit'));
    fireEvent.press(view.getByTestId('group-emoji-📚'));
    fireEvent.press(view.getByTestId('group-save'));
    await waitFor(() => expect(chat.renameGroup).toHaveBeenCalled());
    expect(haptic).not.toHaveBeenCalled();
  });

  it('while the group loads: member-row skeleton (F8), no spinner (F11)', () => {
    mockThread.loading = true;
    mockThread.meta = null;
    const v = render(<GroupInfoScreen />);
    expect(v.getByTestId('group-info-loading').props.accessibilityRole).toBe('progressbar');
    expect(v.getByLabelText('Loading group')).toBeTruthy();
    expect(v.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
  });

  it('a refused action is shown in words, not swallowed', async () => {
    chat.renameGroup.mockRejectedValueOnce(new Error('Only the group owner or an admin can rename it.'));
    const view = render(<GroupInfoScreen />);
    fireEvent.press(view.getByTestId('group-edit'));
    fireEvent.press(view.getByTestId('group-save'));
    await waitFor(() => expect(showAlert).toHaveBeenCalledWith("Couldn't save that", 'Only the group owner or an admin can rename it.'));
  });

  it('mute offers durations and stores the chosen end time', async () => {
    const view = render(<GroupInfoScreen />);
    fireEvent.press(view.getByTestId('group-mute'));
    fireEvent.press(view.getByTestId('mute-8h'));
    await waitFor(() => expect(chat.muteConversation).toHaveBeenCalledWith('g1', expect.any(String)));
    const until = Date.parse(chat.muteConversation.mock.calls[0][1]);
    expect(until - Date.now()).toBeGreaterThan(7.9 * 3600 * 1000);
  });

  it('a muted group can be unmuted in one tap', async () => {
    group('owner', undefined, '2999-12-31T00:00:00.000Z');
    const view = render(<GroupInfoScreen />);
    expect(view.getByText('Muted')).toBeTruthy();
    fireEvent.press(view.getByTestId('group-mute'));
    await waitFor(() => expect(chat.muteConversation).toHaveBeenCalledWith('g1', null));
  });

  it('add people: friends not already in, multi-select, add_group_members', async () => {
    mockFriends.push(friend('ana', 'Ana'), friend('cat', 'Cat'), friend('dee', 'Dee'));
    chat.addGroupMembers.mockResolvedValueOnce(2);
    const view = render(<GroupInfoScreen />);
    fireEvent.press(view.getByTestId('group-add'));
    expect(view.queryByTestId('add-ana')).toBeNull(); // already in
    fireEvent.press(view.getByTestId('add-cat'));
    fireEvent.press(view.getByTestId('add-dee'));
    fireEvent.press(view.getByTestId('add-confirm'));
    await waitFor(() => expect(chat.addGroupMembers).toHaveBeenCalledWith('g1', ['cat', 'dee']));
    expect(showAlert).not.toHaveBeenCalled();
  });

  it('says so when the server skipped someone (she does not take group adds)', async () => {
    mockFriends.push(friend('cat', 'Cat'), friend('dee', 'Dee'));
    chat.addGroupMembers.mockResolvedValueOnce(1);
    const view = render(<GroupInfoScreen />);
    fireEvent.press(view.getByTestId('group-add'));
    fireEvent.press(view.getByTestId('add-cat'));
    fireEvent.press(view.getByTestId('add-dee'));
    fireEvent.press(view.getByTestId('add-confirm'));
    await waitFor(() => expect(showAlert).toHaveBeenCalledWith('Added 1 of 2', expect.stringMatching(/group adds/)));
  });

  it('the add picker stops at the 32 cap', async () => {
    const others = Array.from({ length: 30 }, (_, i) => m(`u${i}`, `U${i}`));
    group('owner', others);
    mockFriends.push(friend('cat', 'Cat'), friend('dee', 'Dee'));
    const view = render(<GroupInfoScreen />);
    fireEvent.press(view.getByTestId('group-add'));
    fireEvent.press(view.getByTestId('add-cat'));
    fireEvent.press(view.getByTestId('add-dee'));
    expect(view.getByTestId('add-dee').props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
    fireEvent.press(view.getByTestId('add-confirm'));
    await waitFor(() => expect(chat.addGroupMembers).toHaveBeenCalledWith('g1', ['cat']));
  });

  it('a full group hides Add people', () => {
    group('owner', Array.from({ length: 31 }, (_, i) => m(`u${i}`, `U${i}`)));
    const view = render(<GroupInfoScreen />);
    expect(view.queryByTestId('group-add')).toBeNull();
    expect(view.getByText(/full/i)).toBeTruthy();
  });

  it('leave asks first, calls leave_group and returns to Messages', async () => {
    const view = render(<GroupInfoScreen />);
    await act(async () => { fireEvent.press(view.getByTestId('group-leave')); });
    await waitFor(() => expect(chat.leaveGroup).toHaveBeenCalledWith('g1'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/messages');
  });

  it('a group she cannot see says so instead of spinning', () => {
    mockThread.meta = null;
    mockThread.unavailable = true;
    const view = render(<GroupInfoScreen />);
    expect(view.getByText(/isn't available/i)).toBeTruthy();
  });

  it('every member row and action has a label a screen reader can say', () => {
    const view = render(<GroupInfoScreen />);
    expect(view.getByLabelText('Remove Bea from the group')).toBeTruthy();
    expect(view.getByLabelText('Make Bea an admin')).toBeTruthy();
    expect(view.getByLabelText('Remove Ana as admin')).toBeTruthy();
  });

  it('Report group files a conversation report against this group, never herself', () => {
    // She owns it here; the report names the next active member and points at
    // the conversation, which moderators open as a whole thread.
    const view = render(<GroupInfoScreen />);
    fireEvent.press(view.getByTestId('group-report'));
    expect(mockOpenReport).toHaveBeenCalledWith({ userId: 'ana', contentType: 'conversation', contentId: 'g1' });
  });
});
