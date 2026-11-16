import { expect, test } from '@playwright/test';

const green = {
  color: 'green',
  version: 'e2e1234',
  apiUrl: 'https://api-green.exemplo.test',
  wsUrl: 'wss://ws-green.exemplo.test',
  public: { 'auth/client-id': 'e2e-client' },
};

test.describe('config de runtime (/config.json)', () => {
  test('o app usa cor, versão e API do /config.json', async ({ page }) => {
    await page.route('**/config.json', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(green) }),
    );
    const reports: string[] = [];
    await page.route('**/client-errors', async (route) => {
      reports.push(route.request().url());
      await route.fulfill({ status: 202, body: '{}' });
    });

    await page.goto('/');
    const footer = page.getByRole('contentinfo');
    await expect(footer).toContainText('ve2e1234');
    await expect(footer).toContainText('green');

    const sent = page.waitForRequest((r) => r.url().endsWith('/client-errors'));
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('e2e: erro com config de runtime');
      });
    });
    expect((await sent).url()).toBe('https://api-green.exemplo.test/client-errors');
    await expect.poll(() => reports.length).toBe(1);
  });

  test('sem /config.json o app sobe no modo local', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toContainText('vdev');
    await expect(page.getByRole('contentinfo')).not.toContainText('green');
  });
});
