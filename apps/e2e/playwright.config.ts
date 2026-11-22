import { defineConfig, devices } from '@playwright/test';
import { API_PORT, DATABASE_URL, TOKENS_JSON, WEB_PORT } from './env.js';

export default defineConfig({
  testDir: './tests',
  // 同じDBを共有するため直列実行
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'tsx db-reset.ts && pnpm --filter @mikke/api start',
      url: `http://localhost:${API_PORT}/healthz`,
      reuseExistingServer: false,
      env: { DATABASE_URL, PORT: String(API_PORT), MIKKE_API_TOKENS: TOKENS_JSON },
    },
    {
      command: `pnpm --filter @mikke/web dev --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { MIKKE_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
