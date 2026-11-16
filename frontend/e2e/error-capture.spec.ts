import { type Page, type Request, expect, test } from '@playwright/test';

interface SentEvent {
  type: string;
  message: string;
  url: string;
  route?: string;
  appVersion: string;
}

/** Intercepta o POST /client-errors (nunca chega à API real) e coleta os eventos. */
async function captureClientErrors(page: Page): Promise<SentEvent[]> {
  const events: SentEvent[] = [];
  await page.route('**/client-errors', async (route) => {
    const body = route.request().postData() ?? '{}';
    events.push(...(JSON.parse(body) as { events: SentEvent[] }).events);
    await route.fulfill({ status: 202, body: '{"accepted":1}' });
  });
  return events;
}

const isClientErrors = (r: Request) => r.url().endsWith('/client-errors') && r.method() === 'POST';

test.describe('captura de erros do frontend', () => {
  test('erro de JavaScript e promessa rejeitada são enviados para /client-errors', async ({
    page,
  }) => {
    const events = await captureClientErrors(page);
    await page.goto('/conta');
    await expect(page.getByRole('heading', { name: 'Minha conta' })).toBeVisible();

    const sent = page.waitForRequest(isClientErrors);
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('e2e: erro proposital');
      });
      void Promise.reject(new Error('e2e: rejeição proposital'));
    });
    await sent;

    await expect.poll(() => events.map((e) => e.type).sort()).toEqual(['js', 'promise']);
    expect(events.find((e) => e.type === 'js')).toMatchObject({
      message: expect.stringContaining('e2e: erro proposital'),
      route: '/conta',
      appVersion: 'dev',
    });
  });

  test('console.error também é capturado', async ({ page }) => {
    const events = await captureClientErrors(page);
    await page.goto('/');
    const sent = page.waitForRequest(isClientErrors);
    // eslint-disable-next-line no-console -- o teste provoca erros no console de propósito
    await page.evaluate(() => console.error('e2e: falha registrada no console'));
    await sent;
    await expect
      .poll(() => events)
      .toContainEqual(
        expect.objectContaining({ type: 'console', message: 'e2e: falha registrada no console' }),
      );
  });

  test('o mesmo erro repetido não inunda a API', async ({ page }) => {
    const events = await captureClientErrors(page);
    await page.goto('/');
    const sent = page.waitForRequest(isClientErrors);
    await page.evaluate(() => {
      // eslint-disable-next-line no-console -- o teste provoca erros no console de propósito
      for (let i = 0; i < 20; i++) console.error('e2e: repetido');
    });
    await sent;
    await expect.poll(() => events.filter((e) => e.message === 'e2e: repetido').length).toBe(3);
    await page.waitForTimeout(500);
    expect(events.filter((e) => e.message === 'e2e: repetido')).toHaveLength(3);
  });
});
