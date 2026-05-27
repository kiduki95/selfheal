// Playwright configuration for selfheal web/ SPA E2E tests.
// The webServer command builds the app first then starts `vite preview`.
// reuseExistingServer lets you run a preview server manually and skip the build
// during iteration (set env SKIP_BUILD=1 and keep a preview running on 4173).

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // One retry on CI, none locally.
  retries: process.env.CI ? 2 : 0,
  // Fail fast: stop after the first 5 failed tests to keep noise low.
  maxFailures: 5,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:4173',
    // Capture screenshot + trace only on failure.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Build first (tsc + vite), then start the preview server.
    // If dist/ already exists and you just want to re-run tests, set
    // REUSE_SERVER=1 in your shell and keep `npm run preview` running.
    command: 'npm run build && npm run preview',
    cwd: '.',          // relative to playwright.config.ts, i.e. web/
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,  // build + preview startup can take up to 2 minutes
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
