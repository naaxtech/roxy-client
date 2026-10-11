/**
 * Push registration, Android channels, tap routing and "don't buzz the chat
 * she is looking at" (lib/pushRegistration.ts).
 *
 * The device side of migration 129. Before this, lib/push.ts upserted one token
 * into push_tokens (a single row per user, so a second phone overwrote the
 * first), never removed it on sign-out (the next person on a shared phone kept
 * receiving her pushes), created no Android channels (so every push rang on the
 * default channel and could not be silenced per type), and showed a banner for
 * the very chat she was reading.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';
import {
  ANDROID_CHANNELS,
  isForegroundDuplicate,
  pathFromPushUrl,
  registerDevice,
  unregisterDevice,
  setActivePath,
} from '../../lib/pushRegistration';

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.0', extra: { eas: { projectId: 'proj-1' } } } },
}));
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

const N = Notifications as jest.Mocked<typeof Notifications>;
const rpc = supabase.rpc as jest.Mock;

function setOS(os: 'ios' | 'android' | 'web') {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  setOS('android');
  rpc.mockResolvedValue({ data: null, error: null });
  N.getPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
  N.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]', type: 'expo' } as never);
  setActivePath(null);
});

describe('registerDevice', () => {
  it('registers this phone through the RPC, with platform and app version', async () => {
    await expect(registerDevice()).resolves.toBe('ExponentPushToken[abc]');
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
    expect(rpc).toHaveBeenCalledWith('register_push_device', {
      p_token: 'ExponentPushToken[abc]', p_platform: 'android', p_app_version: '1.2.0',
    });
  });

  it('creates every Android channel before asking for a token', async () => {
    await registerDevice();
    const ids = N.setNotificationChannelAsync.mock.calls.map((c) => c[0]);
    expect(ids).toEqual(ANDROID_CHANNELS.map((c) => c.id));
    expect(ids).toEqual(expect.arrayContaining(['messages', 'friends', 'events', 'community', 'membership', 'quiet']));
  });

  it('asks once when permission is undetermined, and stops quietly on denial', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
    N.requestPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
    await expect(registerDevice()).resolves.toBeNull();
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does nothing on web (Expo push is native-only)', async () => {
    setOS('web');
    await expect(registerDevice()).resolves.toBeNull();
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the server refuses', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(registerDevice()).resolves.toBeNull();
  });
});

describe('unregisterDevice', () => {
  it('removes the token this phone registered, so the next account on it gets nothing of hers', async () => {
    await registerDevice();
    rpc.mockClear();
    await unregisterDevice();
    expect(rpc).toHaveBeenCalledWith('unregister_push_device', { p_token: 'ExponentPushToken[abc]' });
  });

  it('never throws, even offline — sign-out must not be blocked by it', async () => {
    await registerDevice();
    rpc.mockRejectedValue(new Error('offline'));
    await expect(unregisterDevice()).resolves.toBeUndefined();
  });
});

describe('pathFromPushUrl', () => {
  it('turns the dispatcher deep link into an app path', () => {
    expect(pathFromPushUrl('roxy://chat/c1')).toBe('/chat/c1');
    expect(pathFromPushUrl('roxy://community/channels/k9')).toBe('/community/channels/k9');
    expect(pathFromPushUrl('roxy://notifications')).toBe('/notifications');
  });

  it('refuses anything that is not a roxy:// link', () => {
    expect(pathFromPushUrl('https://evil.example/chat/1')).toBeNull();
    expect(pathFromPushUrl('roxy://')).toBeNull();
    expect(pathFromPushUrl(undefined)).toBeNull();
    expect(pathFromPushUrl(42)).toBeNull();
  });
});

describe('isForegroundDuplicate', () => {
  it('suppresses the banner for the chat she is already reading', () => {
    setActivePath('/chat/c1');
    expect(isForegroundDuplicate({ url: 'roxy://chat/c1' })).toBe(true);
    expect(isForegroundDuplicate({ url: 'roxy://chat/other' })).toBe(false);
  });

  it('shows everything when no chat is open', () => {
    setActivePath(null);
    expect(isForegroundDuplicate({ url: 'roxy://chat/c1' })).toBe(false);
  });
});
