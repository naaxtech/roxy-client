import type { Page } from '@playwright/test';

export type UiDiagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
};

export function attachDiagnostics(page: Page): UiDiagnostics {
  const diag: UiDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
  };

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      diag.consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    diag.pageErrors.push(err.message);
  });

  page.on('response', (res) => {
    const url = res.url();
    if (res.status() >= 400 && (url.includes('supabase') || url.includes('/rest/v1/'))) {
      diag.failedRequests.push(`${res.status()} ${url}`);
    }
  });

  return diag;
}

export function formatDiagnostics(diag: UiDiagnostics): string {
  const parts: string[] = [];
  if (diag.pageErrors.length) {
    parts.push(`Page errors:\n${diag.pageErrors.map((e) => `  - ${e}`).join('\n')}`);
  }
  if (diag.consoleErrors.length) {
    parts.push(`Console errors:\n${diag.consoleErrors.slice(0, 10).map((e) => `  - ${e}`).join('\n')}`);
  }
  if (diag.failedRequests.length) {
    parts.push(`Failed API:\n${diag.failedRequests.slice(0, 10).map((e) => `  - ${e}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** Ignore known benign web-only noise (native modules, PostHog, etc.). */
export function filterBenignErrors(messages: string[]): string[] {
  const ignore = [
    /posthog/i,
    /firebase/i,
    /stripe/i,
    /daily/i,
    /expo-notifications/i,
    /ResizeObserver/i,
  ];
  return messages.filter((m) => !ignore.some((re) => re.test(m)));
}
