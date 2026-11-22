import { expect, test } from '@playwright/test';
import { loginOk, seedResource, unique } from './helpers.js';

test('資産の作成が監査ログに actor 付きで記録され、画面で閲覧できる', async ({ page, request }) => {
  const name = unique('e2e-audit');
  const res = await seedResource(request, { resource_type: 'application', name, detail: {} });
  await loginOk(page);
  await page.getByTestId('nav-audit-logs').click();
  await expect(page.getByRole('heading', { name: '監査ログ' })).toBeVisible();
  await expect(page.getByText(res.id).first()).toBeVisible();
  await expect(page.getByText('e2e:admin').first()).toBeVisible();
});
