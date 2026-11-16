import { defineConfig, devices } from '@playwright/test';

const PORT = 4200;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'pt-BR',
  },
  projects: [
    {
      name: 'chromium',
      // PW_CHANNEL=chrome usa o Chrome instalado na máquina em vez do Chromium do Playwright.
      use: { ...devices['Desktop Chrome'], channel: process.env['PW_CHANNEL'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel: process.env['PW_CHANNEL'] },
    },
  ],
  // Contra um ambiente publicado (E2E_BASE_URL, ex.: smoke do deploy) não sobe servidor local.
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: `npx ng serve --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env['CI'],
        timeout: 180_000,
      },
});
