import { posthog } from './posthog';
import { APP_NAME } from './posthogErrorTracking';

/**
 * Hash a user_id to an 8-char hex string before it reaches PostHog.
 * Same FNV-1a as the mobile client — support can group events without
 * transmitting the real id.
 */
export function hashUserId(userId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function logError(e: unknown, context?: string): void {
  const error = e instanceof Error ? e : new Error(String(e));

  try {
    posthog.captureException(error, {
      error_context: context ?? null,
      app: APP_NAME,
    });
  } catch {}
}

export function logBoundaryError(error: Error, componentStack: string): void {
  try {
    posthog.captureException(error, {
      error_context: 'ErrorBoundary',
      app: APP_NAME,
      component_stack: componentStack.slice(0, 2000),
    });
  } catch {}
}
