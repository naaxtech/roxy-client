import crashlytics from '@react-native-firebase/crashlytics';
import { posthog } from './posthog';

export function logError(e: unknown, context?: string): void {
  const error = e instanceof Error ? e : new Error(String(e));
  if (context) crashlytics().log(context);
  crashlytics().recordError(error);
  try { posthog.captureException(error, { context: context ?? null }); } catch {}
}

export function setCrashlyticsUser(userId: string | null): void {
  crashlytics().setUserId(userId ?? '');
}
