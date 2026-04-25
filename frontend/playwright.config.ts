import { defineConfig, devices } from '@playwright/test';

// Treat empty-string env vars as unset. `??` only falls back on
// `undefined`/`null`, so `PLAYWRIGHT_BASE_URL=""` would otherwise
// produce an empty baseURL and tests would silently target the empty
// string.
const envURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const baseURL = envURL && envURL.length > 0 ? envURL : 'http://localhost:3001';
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30000,

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: skipWebServer
    ? undefined
    : {
        command: 'npm run dev',
        // `npm run dev` always binds to 3001, so the readiness probe must
        // hit 3001 too. Setting `url: baseURL` would break here when a
        // caller overrides PLAYWRIGHT_BASE_URL without also setting
        // PLAYWRIGHT_SKIP_WEB_SERVER — the probe would poll the wrong
        // port and time out after 120s with a misleading error.
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
