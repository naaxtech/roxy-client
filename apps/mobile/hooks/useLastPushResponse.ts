/**
 * useLastPushResponse — the push a member tapped to open the app, or null.
 *
 * expo-notifications' useLastNotificationResponse() calls the native
 * getLastNotificationResponseAsync(), which does not exist on web: on
 * roxy.expo.app it threw an uncaught page error on every signed-in load.
 * Web never receives a tapped native push, so it simply has no response.
 *
 * The choice is made once at module load (Platform.OS never changes at runtime),
 * so each platform always calls the same hooks in the same order.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

function useNoPushResponse(): Notifications.NotificationResponse | null | undefined {
  return null;
}

export const useLastPushResponse: () => Notifications.NotificationResponse | null | undefined =
  Platform.OS === 'web' ? useNoPushResponse : Notifications.useLastNotificationResponse;
