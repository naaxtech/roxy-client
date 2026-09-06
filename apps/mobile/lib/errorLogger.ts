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
  //
  // Guarded for the same reason the PostHog block below always was, which the
  // Crashlytics block was not: **telemetry must never be able to break the thing
  // it is observing.** An unguarded `crashlytics()` call inside a catch block
  // throws out of the catch, so the screen never reaches the line that shows the
  // error state — and a woman sits watching a spinner forever because the error
  // reporter failed. Found exactly that way: a create sheet stuck on "Finding
  // your rooms…" because the failure path logged before it rendered.
  try {
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
  } catch {}

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
 * Never pass a tier-1 field (email, phone, display_name, username, bio,
 * identity_labels, pronouns, location, avatar_url, message/post content) —
 * strip it instead. Always hash a user_id with `hashUserId()` first.
 *
 * @example
 *   logBreadcrumb('onboarding_step1_submit', { label_count: String(labels.length) });
 *   logBreadcrumb('profile_fetch', { user_id: hashUserId(user.id) });
 */
export function logBreadcrumb(
  message: string,
  data?: Record<string, string>,
): void {
  const payload = data
    ? `${message} — ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(', ')}`
    : message;

  try {
    crashlytics().log(`[breadcrumb] ${payload}`);
  } catch {}

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

  // Guarded: this one runs inside React's error path. A throw here would turn a
  // recoverable render error into an unrecoverable one.
  try {
    crashlytics().log(`[ErrorBoundary] ${error.name}: ${error.message}`);
    crashlytics().setAttribute('component_stack', componentStack.slice(0, 1000));
    if (error.stack) {
      crashlytics().setAttribute('stack_trace', error.stack.slice(0, 1000));
    }
    crashlytics().recordError(error);
  } catch {}

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

/**
 * Hash a user_id to an 8-char hex string before it reaches any third-party
 * log/analytics call — required by CLAUDE.md §10 ("LOG ANONYMISED: user_id").
 * Not for security, only for de-identification — a stable, non-reversible-
 * enough correlation key so support can group events by user without ever
 * transmitting the real id to Crashlytics/PostHog/Firebase.
 */
export function hashUserId(userId: string): string {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function setCrashlyticsUser(userId: string | null): void {
  try {
    crashlytics().setUserId(userId ? hashUserId(userId) : '');
  } catch {}
}
