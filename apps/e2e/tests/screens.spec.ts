import { test } from '@playwright/test';
import { loginOk, seedResource, unique } from './helpers.js';

// 見た目の確認用。SCREENSHOT_DIR を指定したときだけ全画面のスクリーンショットを保存する
const dir = process.env.SCREENSHOT_DIR;
test.skip(!dir, 'SCREENSHOT_DIR 未指定');

const pages: [string, string][] = [
  ['resources', '/resources'], ['resource-new', '/resources/new'], ['products', '/software/products'],
  ['installations', '/software/installations'], ['cycles', '/software/release-cycles'], ['eol', '/eol'],
  ['approvals', '/software/lifecycle-event-change-requests'], ['audit', '/audit-logs'], ['diagrams', '/diagrams'],
];

test('主要画面のスクリーンショット', async ({ page, request }) => {
  const host = await seedResource(request, { resource_type: 'compute', name: unique('web-01'), environment: 'prod', detail: { asset_kind: 'vps', hostname: 'web-01.internal' } });
  await seedResource(request, { resource_type: 'application', name: unique('portal'), environment: 'prod', detail: {} });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await loginOk(page);
  for (const [name, path] of pages) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
  await page.goto(`/resources/${host.id}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${dir}/resource-detail.png`, fullPage: true });
  await page.context().clearCookies();
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  await page.screenshot({ path: `${dir}/login.png` });
});
