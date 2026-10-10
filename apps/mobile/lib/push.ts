import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { isForegroundDuplicate, pathFromPushUrl, registerDevice } from './pushRegistration';

/**
 * App-wide push wiring. The rules live in lib/pushRegistration.ts (tested);
 * this file only connects them to expo-notifications and the router.
 *
 * Tap routing moved to app/(tabs)/_layout.tsx (useLastNotificationResponse +
 * router.push). It used to be a module-level listener calling Linking.openURL,
 * which missed the cold-start tap and re-entered the app from the top.
 */

if (Platform.OS !== 'web') {
  // Foreground: show the banner, play the sound, set the badge — except for the
  // chat she is already reading, which would buzz her about the message on
  // screen.
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const duplicate = isForegroundDuplicate(n.request.content.data as { url?: unknown });
      return {
        shouldShowAlert: !duplicate,
        shouldPlaySound: !duplicate,
        shouldSetBadge: true,
      };
    },
  });
}

/**
 * Where a tapped push should take her, as an app path — or null.
 * push-dispatch puts `data.url = roxy://<path>` on every message.
 */
export function pushResponsePath(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  if (!response) return null;
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  return pathFromPushUrl(
    (response.notification.request.content.data as { url?: unknown } | undefined)?.url,
  );
}

/**
 * Register this phone for the signed-in user.
 *
 * Kept under its old name so callers do not change. It used to upsert a single
 * row into push_tokens (065), which a second phone overwrote and nothing ever
 * read; it now registers through `register_push_device` (129), one row per
 * device.
 */
export async function registerPushToken(_userId: string): Promise<void> {
  await registerDevice();
}
