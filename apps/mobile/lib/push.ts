import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { logError } from './errorLogger';

// Show the banner, play a sound and set the badge even when the app is already
// in the foreground — otherwise a push would be silently swallowed while she is
// reading, which is the one moment the notification matters most.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  // A tapped notification routes to the screen it points at. `send-message-push`
  // sets `data.url` to a `roxy://…` deep link; expo-router owns the scheme and
  // opens the conversation. A cold-start tap is handled by expo-router from the
  // launch URL instead of this listener.
  Notifications.addNotificationResponseReceivedListener((response) => {
    const url = response.notification.request.content.data?.url;
    if (typeof url === 'string' && url.length > 0) {
      void Linking.openURL(url);
    }
  });
}

/**
 * Ask once for permission, then persist this device's Expo push token so the
 * server can reach her for messages and friend requests with the app closed.
 *
 * No-op on web (Expo push is native-only) and on denial. A failed upsert is
 * logged and ignored — the token can be retried on the next launch. `push_tokens`
 * (migration 065) is RLS-scoped to the caller's own row, so this writes as her,
 * not through a service-role RPC.
 */
export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      if (asked.status !== 'granted') return;
    }
    const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
    const projectId = extra?.eas?.projectId;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase
      .from('push_tokens')
      .upsert({ user_id: userId, token: token.data, updated_at: new Date().toISOString() });
    if (error) logError(error, 'push.registerToken');
  } catch (e) {
    logError(e, 'push.registerToken');
  }
}
