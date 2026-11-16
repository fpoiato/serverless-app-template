import { expect, test } from '@playwright/test';
import project from '../../project.config.json' with { type: 'json' };

test.describe('navegação', () => {
  test('página inicial abre em pt-BR', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(project.displayName);
    await expect(page.getByRole('heading', { name: project.displayName })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    // Moeda formatada no padrão brasileiro
    await expect(page.getByTestId('locale-sample')).toContainText('12.345,67');
  });

  test('rodapé exibe © ano atual e nome da loja', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toContainText(
      `© ${new Date().getFullYear()} ${project.displayName}`,
    );
  });

  test('menu leva à área do cliente', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Minha conta' }).click();
    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.getByRole('heading', { name: 'Minha conta' })).toBeVisible();
  });

  test('rota inexistente mostra página de não encontrado', async ({ page }) => {
    await page.goto('/nao-existe/123');
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
    await page.getByRole('link', { name: 'Voltar ao início' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
