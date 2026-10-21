import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, act, waitFor, configure } from '@testing-library/react-native';

configure({ defaultIncludeHiddenElements: true });

const mockPush = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-svg', () => ({
  __esModule: true, default: 'Svg', Circle: 'Circle', Ellipse: 'Ellipse', Path: 'Path', G: 'G',
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../components/feed/MiniWinsSheet', () => ({ MiniWinsSheet: () => null }));
jest.mock('../../components/settings/ViewAsPicker', () => ({ ViewAsPicker: () => null }));
jest.mock('../../lib/pushRegistration', () => ({ unregisterDevice: jest.fn() }));
jest.mock('../../lib/dataExport', () => ({ exportUserData: jest.fn(), describeExportResult: jest.fn() }));
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { signOut: jest.fn(), getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) },
    from: jest.fn(),
  },
  callEdgeFunction: jest.fn(),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn(), confirmAction: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../lib/chat', () => ({
  ...jest.requireActual('../../lib/chat'),
  fetchChatSettings: jest.fn(() => Promise.resolve({ read_receipts: true, group_add_permission: 'friends' })),
  setChatSettings: jest.fn(),
}));
let mockBeta = false;
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({ isBeta: mockBeta, isCore: false, can: () => true }),
}));
jest.mock('../../store/authStore', () => ({
  useAuthStore: Object.assign(
    (sel?: (s: unknown) => unknown) => {
      const state = { user: { id: 'amara', email: 'amara@seed.roxy.app' } };
      return typeof sel === 'function' ? sel(state) : state;
    },
    { getState: () => ({ signOut: jest.fn() }) },
  ),
}));
jest.mock('../../store/profileStore', () => ({
  useProfileStore: Object.assign(
    (sel?: (s: unknown) => unknown) => {
      const state = { profile: { id: 'amara', dm_permission: 'everyone', display_name: 'Amara' }, updateProfile: jest.fn() };
      return typeof sel === 'function' ? sel(state) : state;
    },
    { getState: () => ({ setProfile: jest.fn() }) },
  ),
}));
jest.mock('../../store/safetyStore', () => ({
  useSafetyStore: (sel: (s: { blockedUserIds: string[] }) => unknown) => sel({ blockedUserIds: [] }),
}));

import SettingsScreen from '../../app/(tabs)/you/settings';
import { useRoxyFab, onListScroll, ROXY_OFF_COPY } from '../../lib/roxyFab';
import { useThemeStore } from '../../store/themeStore';
import { useRoxyChatStore } from '../../store/roxyChatStore';
import { FAB_LANE } from '../../components/nav/navTokens';
import { THEMES } from '../../lib/theme';

const { confirmAction } = jest.requireMock('../../lib/confirm');
const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  mockBeta = false;
  useRoxyFab.setState({ enabled: true, loadedFor: 'amara', tucked: false, anchor: 0 });
  useThemeStore.setState({ theme: 'light', choice: 'light' });
  useRoxyChatStore.setState({ messages: [], isTyping: false });
});

/**
 * Settings, v2 (design direction › Settings, board v2-07). The first group
 * holds the choices people come for: Roxy AI on/off and the theme. Turning
 * Roxy AI off is instant, says one sentence and offers Undo for 6 seconds —
 * no confirm, no guilt. Every other row Settings had stays.
 */
describe('Settings — Roxy AI', () => {
  it('leads with Roxy AI: her O, what she is, an M3 switch that is on', () => {
    const v = render(<SettingsScreen />);
    expect(v.getByText('Roxy AI')).toBeTruthy();
    expect(v.getByText('Your companion, one tap away on Feed, Discover and You')).toBeTruthy();
    expect(v.getByTestId('settings-roxy-ai-o')).toBeTruthy();
    expect(v.getByTestId('settings-roxy-ai').props.accessibilityRole).toBe('switch');
    expect(v.getByTestId('settings-roxy-ai').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('switching her off is instant, says one sentence, and Undo brings her back', async () => {
    const v = render(<SettingsScreen />);
    await act(async () => { fireEvent.press(v.getByTestId('settings-roxy-ai')); });
    expect(useRoxyFab.getState().enabled).toBe(false);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(v.getByText(ROXY_OFF_COPY)).toBeTruthy();
    expect(v.getByText('Off. Turn her on any time.')).toBeTruthy();
    expect(v.getByTestId('settings-roxy-ai-o-rest')).toBeTruthy();
    await act(async () => { fireEvent.press(v.getByText('Undo')); });
    expect(useRoxyFab.getState().enabled).toBe(true);
    expect(v.getByText('Your companion, one tap away on Feed, Discover and You')).toBeTruthy();
  });

  it('while she is off, her chat stays reachable and can be deleted', async () => {
    useRoxyFab.setState({ enabled: false });
    useRoxyChatStore.getState().addMessage({ role: 'user', content: 'hi' });
    const v = render(<SettingsScreen />);
    fireEvent.press(v.getByText('Your chat with Roxy AI'));
    expect(mockPush).toHaveBeenCalledWith('/roxy-chat');
    const del = v.getByText('Delete my Roxy AI chat');
    expect(flat(del).color).toBe(THEMES.light.dangerInk);
    await act(async () => { fireEvent.press(del); });
    expect(confirmAction).toHaveBeenCalled();
    expect(useRoxyChatStore.getState().messages).toEqual([]);
  });

  it('no delete button when there is no chat to delete (no dead buttons)', () => {
    useRoxyFab.setState({ enabled: false });
    const v = render(<SettingsScreen />);
    expect(v.getByText('Your chat with Roxy AI')).toBeTruthy();
    expect(v.queryByText('Delete my Roxy AI chat')).toBeNull();
  });
});

describe('Settings — Theme', () => {
  it('is a connected Light · Dark · Match phone group, Light selected by default', () => {
    const v = render(<SettingsScreen />);
    expect(v.getByText('Theme')).toBeTruthy();
    expect(v.getByTestId('theme-light').props.accessibilityState).toMatchObject({ selected: true });
    expect(v.getByTestId('theme-dark').props.accessibilityState).toMatchObject({ selected: false });
    expect(v.getByTestId('theme-system').props.accessibilityState).toMatchObject({ selected: false });
    expect(v.getByText('Match phone')).toBeTruthy();
    expect(flat(v.getByTestId('theme-light')).backgroundColor).toBe(THEMES.light.pink);
  });

  it('picks Dark and Match phone', async () => {
    const v = render(<SettingsScreen />);
    await act(async () => { fireEvent.press(v.getByTestId('theme-dark')); });
    await waitFor(() => expect(useThemeStore.getState().choice).toBe('dark'));
    await act(async () => { fireEvent.press(v.getByTestId('theme-system')); });
    await waitFor(() => expect(useThemeStore.getState().choice).toBe('system'));
  });
});

describe('Settings — every row stays', () => {
  it('keeps privacy, chats, streak, support and account rows', async () => {
    const v = render(<SettingsScreen />);
    for (const label of [
      'Who can message me', 'Blocked & muted', 'Notification settings', 'Read receipts',
      'Who can add me to groups', 'Mini Wins', 'Feedback & ideas', 'Export my data',
      'Delete my account', 'Sign out', 'amara@seed.roxy.app',
    ]) {
      expect(v.getByText(label)).toBeTruthy();
    }
    await waitFor(() => expect(v.getByTestId('settings-read-receipts')).toBeTruthy());
  });

  it('Dating and Ghost stay for beta, on the same M3 switch', () => {
    mockBeta = true;
    const v = render(<SettingsScreen />);
    expect(v.getByText('Dating mode')).toBeTruthy();
    expect(v.getByText('Ghost mode')).toBeTruthy();
    expect(v.getByTestId('settings-dating').props.accessibilityRole).toBe('switch');
    expect(v.getByTestId('settings-ghost').props.accessibilityRole).toBe('switch');
  });

  it('ships no Premium or discreet entry yet, and no language row (held, no dead buttons)', () => {
    const v = render(<SettingsScreen />);
    expect(v.queryByText(/Premium/)).toBeNull();
    expect(v.queryByText(/Discreet/)).toBeNull();
    expect(v.queryByText('Language')).toBeNull();
  });

  it('no emoji or flower in the chrome, no tracked capitals', () => {
    const v = render(<SettingsScreen />);
    const json = JSON.stringify(v.toJSON());
    expect(json).not.toContain('🔥');
    expect(json).not.toContain('✿');
    expect(json).not.toContain('"textTransform":"uppercase"');
  });

  it('the list tucks Roxy on scroll and ends a lane higher', () => {
    const v = render(<SettingsScreen />);
    const list = v.getByTestId('settings-scroll');
    expect(list.props.onScroll).toBe(onListScroll);
    const content = StyleSheet.flatten(list.props.contentContainerStyle) as { paddingBottom?: number };
    expect(content.paddingBottom).toBeGreaterThanOrEqual(FAB_LANE);
  });
});
