import { expect, test } from '@playwright/test';
import { loginOk, seedResource, unique } from './helpers.js';

test.describe('資産の登録・編集・検索・アーカイブ', () => {
  test('compute を登録して詳細・一覧で確認し、編集できる', async ({ page }) => {
    const name = unique('e2e-host');
    await loginOk(page);
    await page.getByTestId('create-resource').click();
    await page.getByLabel('名前 *').fill(name);
    await page.getByLabel('環境').fill('stg');
    await page.getByLabel('資産種別 *').selectOption('vps');
    await page.getByLabel('ホスト名').fill('host.example.internal');
    await page.getByTestId('form-submit').click();

    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('host.example.internal').first()).toBeVisible();

    // 一覧で検索
    await page.getByTestId('nav-resources').click();
    await page.getByLabel('名前で検索').fill(name);
    await expect(page.getByTestId('list-table').getByRole('link', { name })).toBeVisible();

    // 編集
    await page.getByTestId('list-table').getByRole('link', { name }).click();
    await page.getByRole('link', { name: /編集/ }).first().click();
    await page.getByLabel('説明').fill('更新後の説明');
    await page.getByTestId('form-submit').click();
    await expect(page.getByText('更新後の説明')).toBeVisible();
  });

  test('認証情報入りのリポジトリURLは登録できない', async ({ page }) => {
    await loginOk(page);
    await page.getByTestId('create-resource').click();
    await page.getByLabel(/^種別 \*/).selectOption('repository');
    await page.getByLabel('名前 *').fill(unique('e2e-repo'));
    await page.getByLabel(/リポジトリURL/).fill('https://user:secret@example.com/org/repo.git');
    await page.getByTestId('form-submit').click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel(/リポジトリURL/)).toHaveValue('');
  });

  test('アーカイブは参照確認の後に実行でき、一覧は既定で除外される', async ({ page, request }) => {
    const name = unique('e2e-arch');
    await seedResource(request, { resource_type: 'application', name, detail: {} });
    await loginOk(page);
    await page.getByLabel('名前で検索').fill(name);
    await page.getByTestId('list-table').getByRole('link', { name }).click();

    await page.getByRole('button', { name: /アーカイブの参照確認/ }).click();
    await page.getByRole('checkbox', { name: /参照一覧を確認しました/ }).check();
    await page.getByTestId('dialog-confirm').click();
    await expect(page.getByText('アーカイブ済み').first()).toBeVisible();

    await page.getByTestId('nav-resources').click();
    await page.getByLabel('名前で検索').fill(name);
    await expect(page.getByTestId('list-table').getByRole('link', { name })).toHaveCount(0);
    // URL 更新後に状態が変わる制御コンポーネントなので check() ではなく click + toBeChecked
    await page.getByLabel(/アーカイブを含む/).click();
    await expect(page.getByLabel(/アーカイブを含む/)).toBeChecked();
    await expect(page.getByTestId('list-table').getByRole('link', { name })).toBeVisible();
  });
});
