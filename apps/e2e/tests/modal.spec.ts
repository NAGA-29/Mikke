import { expect, test } from '@playwright/test';
import { loginOk, seedResource, unique } from './helpers.js';

test('デプロイ登録モーダルをESC・キャンセルで閉じ、保存すると一覧を更新する', async ({ page, request }) => {
  const app = await seedResource(request, { resource_type: 'application', name: unique('modal-app'), detail: {} });
  const host = await seedResource(request, { resource_type: 'compute', name: unique('modal-host'), detail: { asset_kind: 'vps' } });
  await loginOk(page);
  await page.goto(`/resources/${app.id}`);

  const trigger = page.getByTestId('create-deployment');
  const dialog = page.getByRole('dialog', { name: 'デプロイの登録', exact: true });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('dialog-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('アプリケーション（必須）', { exact: true })).toHaveValue(app.id);
  await dialog.getByLabel('配置先：名前で検索', { exact: true }).fill(host.name);
  const target = dialog.getByLabel('配置先（必須）', { exact: true });
  await expect(target.getByRole('option', { name: new RegExp(host.name) })).toHaveCount(1);
  await target.selectOption(host.id);
  await dialog.getByLabel('環境（必須）', { exact: true }).fill('prod');
  const deployPath = `/srv/${unique('modal-deploy')}`;
  await dialog.getByLabel('配置パス / サービス名', { exact: true }).fill(deployPath);
  await dialog.getByTestId('form-submit').click();

  await expect(dialog).toHaveCount(0);
  const row = page.getByRole('table', { name: 'アプリケーション側', exact: true }).getByRole('row').filter({ hasText: deployPath });
  await expect(row).toBeVisible();
  await expect(row.getByRole('link', { name: host.name, exact: true })).toBeVisible();
});
