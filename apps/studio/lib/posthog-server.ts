import { PostHog } from 'posthog-node';
import { APP_NAME } from './posthogErrorTracking';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? process.env.POSTHOG_KEY ?? '';
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

let client: PostHog | null = null;

export function getPostHogServer(): PostHog | null {
  if (!KEY) return null;
  if (!client) {
    client = new PostHog(KEY, { host: HOST });
  }
  return client;
}

export function captureServerException(
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  try {
    // posthog-node: captureException(error, distinctId?, properties?)
    getPostHogServer()?.captureException(error, undefined, {
      app: APP_NAME,
      ...extra,
    });
  } catch {
    // Telemetry must never break the thing it is observing.
  }
}
