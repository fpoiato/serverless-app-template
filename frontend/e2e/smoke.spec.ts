import { expect, test } from '@playwright/test';
import project from '../../project.config.json' with { type: 'json' };

/**
 * Smoke do deploy (#15): roda contra a cor inativa publicada.
 * E2E_BASE_URL = https://<cor>.<domínio>, SMOKE_API_URL = https://api-<cor>.<domínio>
 * e SMOKE_COLOR = <cor>. Sem essas variáveis (e2e local) os testes são ignorados.
 */
const API = process.env['SMOKE_API_URL'];
const COLOR = process.env['SMOKE_COLOR'];

test.describe('smoke (deploy)', () => {
  test.skip(!process.env['E2E_BASE_URL'] || !API, 'só roda contra ambiente publicado');

  test('frontend publicado carrega a página inicial', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: project.displayName })).toBeVisible();
  });

  test('API da cor responde /health com a cor esperada', async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { status: string; color: string };
    expect(body.status).toBe('ok');
    if (COLOR) expect(body.color).toBe(COLOR);
  });
});
