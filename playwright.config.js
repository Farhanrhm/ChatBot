// @ts-check
import { defineConfig } from '@playwright/test';

/**
 * Konfigurasi Playwright Test untuk SobatSteam E2E.
 * Menguji kepatuhan layout, aksesibilitas, dan perilaku antarmuka pengguna.
 */
export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:3600',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
  webServer: {
    command: 'node index.js',
    url: 'http://127.0.0.1:3600/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      PORT: '3600',
      GEMINI_API_KEY: 'dummy',
      SENTRY_DSN: '',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
    },
  },
});
