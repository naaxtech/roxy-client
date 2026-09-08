'use client';

import { useEffect } from 'react';
import { getBrowserPostHog } from '@/lib/posthog-browser';
import { hashUserId } from '@/lib/errorLogger';

export function PostHogIdentify({ userId }: { userId: string | null }) {
  useEffect(() => {
    try {
      const client = getBrowserPostHog();
      if (userId) client?.identify(hashUserId(userId));
      else client?.reset();
    } catch {}
  }, [userId]);
  return null;
}
