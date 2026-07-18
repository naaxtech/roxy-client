import { Alert, Platform } from 'react-native';

/**
 * Cross-platform confirm dialog. react-native-web's Alert.alert is a stub —
 * multi-button alerts never render in the browser, so confirm onPress
 * handlers silently never fire (this is why Sign out "did nothing" on web).
 * Use this for every destructive/confirm flow instead of Alert.alert.
 */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel = 'OK',
  destructive = true,
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      (globalThis as { confirm?: (msg: string) => boolean }).confirm?.(`${title}\n\n${message}`) ?? false,
    );
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
