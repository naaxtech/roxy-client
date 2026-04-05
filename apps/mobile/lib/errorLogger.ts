import crashlytics from '@react-native-firebase/crashlytics';

export function logError(e: unknown, context?: string): void {
  const error = e instanceof Error ? e : new Error(String(e));
  if (context) crashlytics().log(context);
  crashlytics().recordError(error);
}

export function setCrashlyticsUser(userId: string | null): void {
  crashlytics().setUserId(userId ?? '');
}
