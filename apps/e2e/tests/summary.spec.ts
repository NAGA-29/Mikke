import { expect, test } from '@playwright/test';
import { E2E_TOKEN } from '../env.js';
import { loginOk, seedResource, unique } from './helpers.js';

test('資産一覧の件数カードが種別ごとの件数を示し、クリックで絞り込める', async ({ page, request }) => {
  await seedResource(request, { resource_type: 'compute', name: unique('sum-host'), detail: { asset_kind: 'vps' } });
  await seedResource(request, { resource_type: 'repository', name: unique('sum-repo'), detail: { repository_url: `https://github.com/example-org/${unique('r')}` } });
  const summary = await (await request.get('/api/v1/resources/summary', { headers: { authorization: `Bearer ${E2E_TOKEN}` } })).json();

  await loginOk(page);
  await expect(page.getByTestId('summary-compute')).toContainText(String(summary.by_type.compute.active));
  await expect(page.getByTestId('summary-all')).toContainText(String(summary.total.active));
  await expect(page.getByTestId('summary-all')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('summary-compute').click();
  await expect(page).toHaveURL(/type=compute/);
  await expect(page.getByTestId('summary-compute')).toHaveAttribute('aria-pressed', 'true');
  const rows = page.getByTestId('list-table').locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allInnerTexts()) expect(text).toContain('コンピュート');

  // もう一度押すと解除される
  await page.getByTestId('summary-compute').click();
  await expect(page).not.toHaveURL(/type=/);
  await expect(page.getByTestId('summary-all')).toHaveAttribute('aria-pressed', 'true');
});
