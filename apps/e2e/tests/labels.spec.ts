import { expect, test } from '@playwright/test';
import { loginOk, seedResource, unique } from './helpers.js';

test('種別ごとの詳細は日本語ラベルで、IDは名前で表示される（キー名・UUID を出さない）', async ({ page, request }) => {
  const host = await seedResource(request, { resource_type: 'compute', name: unique('label-host'), detail: { asset_kind: 'vps' } });
  const svc = await seedResource(request, {
    resource_type: 'service_instance', name: unique('label-db'),
    detail: { service_kind: 'database', engine: 'PostgreSQL', engine_version: '16.4', is_managed: false, host_compute_id: host.id },
  });
  await loginOk(page);
  await page.goto(`/resources/${svc.id}`);
  const list = page.getByTestId('detail-list');
  await expect(list.getByText('エンジン', { exact: true })).toBeVisible();
  await expect(list.getByText('マネージドサービス', { exact: true })).toBeVisible();
  await expect(list.getByText('データベース', { exact: true })).toBeVisible(); // service_kind の表示名
  await expect(list.getByRole('link', { name: host.name })).toBeVisible();
  const text = await list.innerText();
  for (const raw of ['host_compute_id', 'service_kind', 'is_managed', 'engine_version', host.id]) expect(text).not.toContain(raw);
});

test('監査ログの操作・対象種別は日本語で表示される', async ({ page, request }) => {
  await seedResource(request, { resource_type: 'application', name: unique('label-audit'), detail: {} });
  await loginOk(page);
  await page.getByTestId('nav-audit-logs').click();
  const row = page.getByRole('row').filter({ hasText: '資産' }).filter({ hasText: '作成' }).first();
  await expect(row).toBeVisible();
});
