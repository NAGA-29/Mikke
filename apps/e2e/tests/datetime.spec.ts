import { expect, test } from '@playwright/test';
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
