import { expect, test } from '@playwright/test';
import { loginOk, seedResource, unique } from './helpers.js';

test('件数が1ページ（50件）を超えると、総件数とページ送りが表示され、全件を辿れる', async ({ page, request }) => {
  const prefix = unique('pg');
  for (let i = 0; i < 55; i++) {
    await seedResource(request, { resource_type: 'application', name: `${prefix}-${String(i).padStart(2, '0')}`, detail: {} });
  }
  await loginOk(page);
  await page.getByLabel('名前で検索').fill(prefix);

  const rows = page.getByTestId('list-table').locator('tbody tr');
  await expect(page.getByTestId('pager-range')).toHaveText('全 55 件中 1–50 件を表示');
  await expect(rows).toHaveCount(50);
  await expect(page.getByTestId('pager-prev')).toBeDisabled();

  await page.getByTestId('pager-next').click();
  await expect(page).toHaveURL(/offset=50/);
  await expect(page.getByTestId('pager-range')).toHaveText('全 55 件中 51–55 件を表示');
  await expect(rows).toHaveCount(5);
  await expect(rows.last()).toContainText(`${prefix}-54`);
  await expect(page.getByTestId('pager-next')).toBeDisabled();

  // 絞り込みを変えると先頭ページに戻る（範囲外の offset で空表示にならない）
  await page.getByLabel('名前で検索').fill(`${prefix}-0`);
  await expect(page).not.toHaveURL(/offset=/);
  await expect(page.getByTestId('pager-range')).toContainText('全 10 件中 1–10 件');
});
