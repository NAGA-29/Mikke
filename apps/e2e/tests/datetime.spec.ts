import { expect, test } from '@playwright/test';
import { E2E_TOKEN } from '../env.js';
import { loginOk, seedResource, unique } from './helpers.js';

// API の値は UTC。画面ではブラウザのタイムゾーンに変換して表示する
const VERIFIED_AT = '2026-11-22T00:30:00Z';

async function seed(request: import('@playwright/test').APIRequestContext) {
  return seedResource(request, {
    resource_type: 'application', name: unique('tz-app'), last_verified_at: VERIFIED_AT, detail: {},
  });
}

test.describe('日時はブラウザのタイムゾーンで表示される', () => {
  test('日本時間（JST）', async ({ page, request }) => {
    const r = await seed(request);
    await loginOk(page);
    await page.goto(`/resources/${r.id}`);
    const time = page.locator('time[datetime="2026-11-22T00:30:00Z"]');
    await expect(time).toHaveText(/2026\/11\/22 09:30 JST/);
    // 元の値（ISO 8601）はツールチップで確認できる
    await expect(time).toHaveAttribute('title', VERIFIED_AT);
  });

  test.describe('米国東部時間', () => {
    test.use({ timezoneId: 'America/New_York', locale: 'en-US' });
    test('日付をまたぐ変換（前日の夜）', async ({ page, request }) => {
      const r = await seed(request);
      await loginOk(page);
      await page.goto(`/resources/${r.id}`);
      await expect(page.locator('time[datetime="2026-11-22T00:30:00Z"]')).toHaveText(/11\/21\/2026.*19:30.*(EST|GMT-5)/);
    });
  });

  test('日付のみの値（EOL日付など DATE 型）は変換されず、解釈できない値もそのまま返す', async () => {
    const { formatDateTime } = await import('../../web/src/lib/datetime.js');
    expect(formatDateTime('2028-12-31')).toBe('2028-12-31');
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
    expect(formatDateTime(null)).toBe('-');
  });
});

test.describe('日時の入力（ブラウザのタイムゾーン → UTC で保存）', () => {
  test('JST で入力した日時が UTC で保存され、画面には JST で表示される', async ({ page, request }) => {
    const name = unique('tz-input');
    await loginOk(page);
    await page.getByTestId('create-resource').click();
    await page.getByLabel(/^種別 \*/).selectOption('application');
    await page.getByLabel('名前 *').fill(name);
    await page.locator('input[type="datetime-local"]').fill('2026-11-22T09:30:00');
    await page.getByTestId('form-submit').click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.locator('time')).toHaveText(/2026\/11\/22 09:30 JST/);

    const list = await request.get(`/api/v1/resources?q=${name}`, { headers: { authorization: `Bearer ${E2E_TOKEN}` } });
    expect((await list.json()).items[0].last_verified_at).toMatch(/^2026-11-22T00:30:00(\.0+)?(Z|\+00:00)$/);
  });

  test('値を変更せず保存しても、元の日時（秒未満を含む）は変わらない', async ({ page, request }) => {
    const r = await seedResource(request, {
      resource_type: 'application', name: unique('tz-keep'), last_verified_at: '2026-11-22T00:30:00.123456Z', detail: {},
    });
    const before = (await (await request.get(`/api/v1/resources/${r.id}`, { headers: { authorization: `Bearer ${E2E_TOKEN}` } })).json()).last_verified_at;
    await loginOk(page);
    await page.goto(`/resources/${r.id}/edit`);
    await expect(page.locator('input[type="datetime-local"]')).toHaveValue('2026-11-22T09:30') // 秒が 0 のときブラウザは :00 を省略する;
    await page.getByLabel('説明').fill('日時は触らない');
    await page.getByTestId('form-submit').click();
    await expect(page.getByText('日時は触らない')).toBeVisible();
    const after = (await (await request.get(`/api/v1/resources/${r.id}`, { headers: { authorization: `Bearer ${E2E_TOKEN}` } })).json()).last_verified_at;
    expect(after).toBe(before);
  });
});
