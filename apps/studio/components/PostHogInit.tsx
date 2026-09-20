'use client';

import { useEffect } from 'react';
import { initPostHog } from '@/lib/posthog-browser';

export function PostHogInit() {
  useEffect(() => {
    initPostHog();
  }, []);
  return null;
}
