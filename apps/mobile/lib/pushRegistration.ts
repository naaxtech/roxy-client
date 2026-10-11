import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { logError } from './errorLogger';

/**
 * This phone's half of the push pipeline (migration 129, push-dispatch).
 *
 *  - registerDevice(): creates the Android channels, asks for permission once,
 *    and registers this phone's Expo token via `register_push_device` (one row
 *    per device; a shared phone moves to whoever signed in last).
 *  - unregisterDevice(): called BEFORE sign-out, while the session still
 *    exists, so the next person on this phone never receives her pushes.
 *  - setActivePath()/isForegroundDuplicate(): no banner for the chat she is
 *    already reading.
 *
 * Kept free of navigation and React so every rule here is unit-tested
 * (__tests__/lib/pushRegistration.test.ts). lib/push.ts wires it into the app.
 */

/**
 * Android channels, one per preference, plus "quiet" for quiet hours. The ids
 * must match `ChannelId` in supabase/functions/_shared/pushCore.ts. Users can
 * also mute each one from Android's own settings.
 */
export const ANDROID_CHANNELS = [
  { id: 'messages', name: 'Messages', importance: Notifications.AndroidImportance.HIGH },
  { id: 'friends', name: 'Friend requests', importance: Notifications.AndroidImportance.HIGH },
  { id: 'events', name: 'Community events', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'community', name: 'Community chats', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'membership', name: 'Your membership', importance: Notifications.AndroidImportance.HIGH },
  { id: 'quiet', name: 'Quiet hours', importance: Notifications.AndroidImportance.LOW },
] as const;

let registeredToken: string | null = null;
let activePath: string | null = null;

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const c of ANDROID_CHANNELS) {
    await Notifications.setNotificationChannelAsync(c.id, {
      name: c.name,
      importance: c.importance,
      // Lock-screen privacy: Android shows the full content on the lock screen
      // unless told otherwise. The dispatcher already keeps text out of the
      // payload by default; this is the second layer.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PRIVATE,
      sound: c.id === 'quiet' ? null : 'default',
      vibrationPattern: c.id === 'quiet' ? null : [0, 200, 120, 200],
    } as Notifications.NotificationChannelInput);
  }
}

/** Register this phone. Returns the token, or null (web, denied, or failed). Never throws. */
export async function registerDevice(): Promise<string | null> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    await ensureAndroidChannels();
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      if (asked.status !== 'granted') return null;
    }
    const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
    const token = await Notifications.getExpoPushTokenAsync({ projectId: extra?.eas?.projectId });
    const { error } = await supabase.rpc('register_push_device', {
      p_token: token.data,
      p_platform: Platform.OS,
      p_app_version: Constants.expoConfig?.version ?? null,
    });
    if (error) {
      logError(error, 'push.registerDevice');
      return null;
    }
    registeredToken = token.data;
    return token.data;
  } catch (e) {
    logError(e, 'push.registerDevice');
    return null;
  }
}

/** Remove this phone's token for the signed-in user. Call BEFORE signOut(). Never throws. */
export async function unregisterDevice(): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  try {
    const { error } = await supabase.rpc('unregister_push_device', { p_token: token });
    if (error) logError(error, 'push.unregisterDevice');
  } catch (e) {
    logError(e, 'push.unregisterDevice');
  } finally {
    registeredToken = null;
  }
}

/** `roxy://chat/c1` -> `/chat/c1`. Anything that is not a roxy:// link -> null. */
export function pathFromPushUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith('roxy://')) return null;
  const rest = url.slice('roxy://'.length).replace(/^\/+/, '');
  if (!rest) return null;
  return `/${rest}`;
}

/** The screen she is looking at right now (set by the chat screens). */
export function setActivePath(path: string | null): void {
  activePath = path;
}

/** True when this push is about the conversation already on screen. */
export function isForegroundDuplicate(data: { url?: unknown } | undefined | null): boolean {
  if (!activePath) return false;
  return pathFromPushUrl(data?.url) === activePath;
}
