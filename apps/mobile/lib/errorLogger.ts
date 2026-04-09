import crashlytics from '@react-native-firebase/crashlytics';
import { posthog } from './posthog';

/**
 * Log an error to Crashlytics + PostHog with full stack trace and context.
 *
 * Use this for caught errors in catch blocks, async failures, and API errors.
 * The global ErrorUtils handler and ErrorBoundary call this automatically for
 * uncaught JS exceptions and React render errors.
 */
export function logError(e: unknown, context?: string): void {
  const error = e instanceof Error ? e : new Error(String(e));

  // Verbose console output in dev — includes context label, message, and full stack.
  if (__DEV__) {
    console.error(
      `\n[Roxy Error]${context ? ` [${context}]` : ''} ${error.name}: ${error.message}`,
    );
    if (error.stack) console.error(error.stack);
  }

  // Crashlytics — log breadcrumb then record the error so the stack trace
  // appears correctly grouped in the Firebase console.
  if (context) {
    crashlytics().log(`[${new Date().toISOString()}] context=${context}`);
    crashlytics().setAttribute('error_context', context);
  }
  if (error.stack) {
    // Crashlytics custom attribute limit is 1024 chars.
    crashlytics().setAttribute('stack_trace', error.stack.slice(0, 1000));
  }
  crashlytics().setAttribute('error_name', error.name);
  crashlytics().recordError(error);

  // PostHog — capture as a named event so errors appear in analytics funnels.
  try {
    posthog?.capture('app_error', {
      error_name: error.name,
      error_message: error.message,
      error_context: context ?? null,
      // Truncate stack for PostHog property limits.
      error_stack: error.stack?.slice(0, 2000) ?? null,
    });
  } catch {}
}

/**
 * Log a breadcrumb — a lightweight timestamped note that appears in Crashlytics
 * reports before any crash, and as an event trail in PostHog session replays.
 *
 * Call this at meaningful navigation/action boundaries so crash reports have
 * a clear trail of what the user did.
 *
 * @example
 *   logBreadcrumb('onboarding_step1_submit', { username });
 *   logBreadcrumb('profile_fetch', { user_id: user.id });
 */
export function logBreadcrumb(
  message: string,
  data?: Record<string, string>,
): void {
  const payload = data
    ? `${message} — ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(', ')}`
    : message;

  crashlytics().log(`[breadcrumb] ${payload}`);

  if (__DEV__) {
    console.log(`[Breadcrumb] ${payload}`);
  }

  try {
    posthog?.capture('breadcrumb', { message, ...data });
  } catch {}
}

/**
 * Log a React ErrorBoundary catch — includes the React componentStack so you
 * can see exactly which component tree caused the render error.
 */
export function logBoundaryError(error: Error, componentStack: string): void {
  if (__DEV__) {
    console.error('\n[ErrorBoundary] Render error:', error.message);
    console.error('[ErrorBoundary] Component stack:', componentStack);
    if (error.stack) console.error('[ErrorBoundary] JS stack:', error.stack);
  }

  crashlytics().log(`[ErrorBoundary] ${error.name}: ${error.message}`);
  crashlytics().setAttribute('component_stack', componentStack.slice(0, 1000));
  if (error.stack) {
    crashlytics().setAttribute('stack_trace', error.stack.slice(0, 1000));
  }
  crashlytics().recordError(error);

  try {
    posthog?.capture('app_error', {
      error_name: error.name,
      error_message: error.message,
      error_context: 'ErrorBoundary',
      component_stack: componentStack.slice(0, 2000),
      error_stack: error.stack?.slice(0, 2000) ?? null,
    });
  } catch {}
}

export function setCrashlyticsUser(userId: string | null): void {
  crashlytics().setUserId(userId ?? '');
}
