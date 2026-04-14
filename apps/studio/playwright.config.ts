import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Auth setup — runs first, saves session to file
    {
      name: 'setup',
      testMatch: '**/auth.setup.ts',
    },
    // Tests that need an authenticated session (only top-level spec files, not unauthenticated/)
    {
      name: 'authenticated',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/session.json',
      },
      testMatch: /.*\/tests\/e2e\/[^/]+\.spec\.ts/,
    },
    // Tests that must run without a session (login page, redirect)
    {
      name: 'unauthenticated',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/unauthenticated/**/*.spec.ts',
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
