import { defineConfig, devices } from '@playwright/test';

/**
 * CRM smoke tests. Expects the API on :4000 (seeded, SEED_MUST_CHANGE_PASSWORD=false) and the CRM on :3000.
 * See docs/testing-plan.md for the exact commands.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.CRM_URL ?? 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
