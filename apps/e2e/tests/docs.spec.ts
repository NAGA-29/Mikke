import { expect, test } from '@playwright/test';
import { loginOk } from './helpers.js';

test('サイドバーからドキュメントを開き、目次から各節へ移動できる', async ({ page }) => {
  await loginOk(page);
  await page.getByTestId('nav-docs').click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole('heading', { name: 'ドキュメント' })).toBeVisible();
  const body = page.getByTestId('docs-body');
  await expect(body.getByRole('heading', { name: 'Mikke とは' })).toBeVisible();

  await page.getByRole('navigation', { name: '目次' }).getByRole('link', { name: 'ソフトウェアと EOL' }).click();
  await expect(page).toHaveURL(/#software$/);
  await expect(body.getByRole('heading', { name: 'ソフトウェアと EOL' })).toBeInViewport();

  // 本文中のリンクから実際の画面へ移動できる
  await body.getByRole('link', { name: 'EOL 状況' }).first().click();
  await expect(page).toHaveURL(/\/eol$/);
});
