'use client';

import posthog from 'posthog-js';
import { APP_NAME, POSTHOG_CAPTURE_EXCEPTIONS } from './posthogErrorTracking';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

let started = false;

export function initPostHog(): void {
  if (!KEY || started) return;
  started = true;
  posthog.init(KEY, {
    api_host: HOST,
    capture_exceptions: POSTHOG_CAPTURE_EXCEPTIONS,
    person_profiles: 'identified_only',
  });
  posthog.register({ app: APP_NAME });
}

export function getBrowserPostHog(): typeof posthog | null {
  if (!KEY) return null;
  initPostHog();
  return posthog;
}
