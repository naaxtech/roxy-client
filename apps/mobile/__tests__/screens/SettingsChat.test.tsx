import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import SettingsScreen from '../../app/(tabs)/you/settings';
import { useChatSettingsStore } from '../../store/chatSettingsStore';

/**
 * Settings & safety → Chats: the read-receipt switch and who can add her to
 * groups, wired to set_chat_settings (migration 132). Receipts are reciprocal
 * and the copy says so before she flips it.
 */
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../components/feed/MiniWinsSheet', () => ({ MiniWinsSheet: () => null }));
jest.mock('../../components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('../../components/settings/ViewAsPicker', () => ({ ViewAsPicker: () => null }));
jest.mock('../../lib/pushRegistration', () => ({ unregisterDevice: jest.fn() }));
jest.mock('../../lib/dataExport', () => ({ exportUserData: jest.fn(), describeExportResult: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: { auth: { signOut: jest.fn() } } }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn(), confirmAction: jest.fn() }));
jest.mock('../../lib/chat', () => ({
  ...jest.requireActual('../../lib/chat'),
  fetchChatSettings: jest.fn(),
  setChatSettings: jest.fn(),
}));
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({ isBeta: false, isCore: false, can: () => true }),
}));
jest.mock('../../store/authStore', () => ({
  useAuthStore: Object.assign(() => ({ user: { id: 'me', email: 'me@seed.roxy.app' } }), { getState: () => ({ signOut: jest.fn() }) }),
}));
jest.mock('../../store/profileStore', () => ({
  useProfileStore: Object.assign(() => ({ profile: { id: 'me', dm_permission: 'everyone' }, updateProfile: jest.fn() }), { getState: () => ({ setProfile: jest.fn() }) }),
}));
jest.mock('../../store/safetyStore', () => ({
  useSafetyStore: (sel: (s: { blockedUserIds: string[] }) => unknown) => sel({ blockedUserIds: [] }),
}));

const chat = jest.requireMock('../../lib/chat');
const { showAlert } = jest.requireMock('../../lib/confirm');

beforeEach(() => {
  jest.clearAllMocks();
  useChatSettingsStore.getState().reset();
  chat.fetchChatSettings.mockResolvedValue({ read_receipts: true, group_add_permission: 'friends' });
});

it('shows the read-receipt switch with the two-way copy, on by default', async () => {
  const view = render(<SettingsScreen />);
  const sw = await view.findByTestId('settings-read-receipts');
  expect(view.getByText('Read receipts')).toBeTruthy();
  expect(view.getByText("If you turn these off, you won't see others' either.")).toBeTruthy();
  await waitFor(() => expect(chat.fetchChatSettings).toHaveBeenCalled());
  expect(sw.props.value).toBe(true);
});

it('reflects a saved "off"', async () => {
  chat.fetchChatSettings.mockResolvedValue({ read_receipts: false, group_add_permission: 'friends' });
  const view = render(<SettingsScreen />);
  await waitFor(() => expect(view.getByTestId('settings-read-receipts').props.value).toBe(false));
});

it('turning it off calls set_chat_settings', async () => {
  chat.setChatSettings.mockResolvedValue({ read_receipts: false, group_add_permission: 'friends' });
  const view = render(<SettingsScreen />);
  await waitFor(() => expect(chat.fetchChatSettings).toHaveBeenCalled());
  await act(async () => { fireEvent(view.getByTestId('settings-read-receipts'), 'valueChange', false); });
  expect(chat.setChatSettings).toHaveBeenCalledWith({ readReceipts: false });
  expect(view.getByTestId('settings-read-receipts').props.value).toBe(false);
});

it('a refused save says so and the switch goes back', async () => {
  chat.setChatSettings.mockRejectedValue(new Error('nope'));
  const view = render(<SettingsScreen />);
  await waitFor(() => expect(chat.fetchChatSettings).toHaveBeenCalled());
  await act(async () => { fireEvent(view.getByTestId('settings-read-receipts'), 'valueChange', false); });
  expect(showAlert).toHaveBeenCalledWith('Not saved', expect.stringMatching(/read receipts/i));
  expect(view.getByTestId('settings-read-receipts').props.value).toBe(true);
});

it('group adds: friends ↔ nobody', async () => {
  chat.setChatSettings.mockResolvedValue({ read_receipts: true, group_add_permission: 'nobody' });
  const view = render(<SettingsScreen />);
  await waitFor(() => expect(chat.fetchChatSettings).toHaveBeenCalled());
  expect(view.getByText('Friends ›')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByTestId('settings-group-adds')); });
  expect(chat.setChatSettings).toHaveBeenCalledWith({ groupAddPermission: 'nobody' });
  expect(view.getByText('Nobody ›')).toBeTruthy();
});
