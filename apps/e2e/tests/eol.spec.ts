import { expect, test } from '@playwright/test';
import { E2E_TOKEN } from '../env.js';
import { api, loginOk, seedResource, unique } from './helpers.js';

const SRC = 'https://www.php.net/supported-versions.php';

/** 稼働中の VPS に PHP 8.4 を導入し、系列と EOL イベントを登録する */
async function seedPhp(request: import('@playwright/test').APIRequestContext) {
  const vps = await seedResource(request, { resource_type: 'compute', name: unique('eol-vps'), detail: { asset_kind: 'vps' } });
  const product = await api(request, 'POST', '/software/products', { name: unique('PHP'), category: 'runtime' });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const inst = await api(request, 'POST', '/software/installations', {
    compute_asset_id: vps.id, software_product_id: product.body.id, version: '8.4.3', install_method: 'apt',
  });
  expect(inst.status, JSON.stringify(inst.body)).toBe(201);
  const cycle = await api(request, 'POST', '/software/release-cycles', {
    software_product_id: product.body.id, cycle: '8.4', assign_to: { target_kind: 'installation', target_id: inst.body.id },
  });
  expect(cycle.status, JSON.stringify(cycle.body)).toBe(201);
  const ev = await api(request, 'POST', '/software/lifecycle-events', {
    release_cycle_id: cycle.body.id, event_type: 'security_support_end', event_date: '2028-12-31', source_url: SRC, checked_at: new Date().toISOString(),
  });
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  return { product: product.body, event: ev.body };
}

test.describe('EOL', () => {
  test('ダッシュボードに稼働中資産の系列が表示される', async ({ page, request }) => {
    const { product } = await seedPhp(request);
    await loginOk(page);
    await page.getByTestId('nav-eol').click();
    await expect(page.getByRole('heading', { name: /EOL/ })).toBeVisible();
    await expect(page.getByRole('table').getByText(product.name).first()).toBeVisible();
  });

  test('承認権限の無い主体の日付変更は承認待ちになり、承認者が UI で承認できる', async ({ page, request }) => {
    const { event } = await seedPhp(request);
    const put = await api(request, 'PUT', `/software/lifecycle-events/${event.id}`, {
      event_date: '2029-06-30', source_url: SRC, source_title: null, checked_at: new Date().toISOString(),
      notes: null, expected_updated_at: event.updated_at, change_note: 'vendor extended support',
    }, 'writer');
    expect(put.status, JSON.stringify(put.body)).toBe(202);
    expect(put.body.change_request.status).toBe('pending');

    await loginOk(page);
    await page.getByTestId('nav-approvals').click();
    await expect(page.getByText('2029-06-30').first()).toBeVisible();
    await expect(page.getByText('vendor extended support').first()).toBeVisible();

    await page.getByRole('button', { name: '承認', exact: true }).click();
    await page.getByRole('checkbox', { name: /依頼者ではなく/ }).check();
    await page.getByTestId('dialog-confirm').click();
    await expect(page.getByText('2029-06-30')).toHaveCount(0);

    // 承認後は正本のイベント日付が更新されている
    const got = await request.get(`/api/v1/software/lifecycle-events/${event.id}`, { headers: { authorization: `Bearer ${E2E_TOKEN}` } });
    expect((await got.json()).event_date).toBe('2029-06-30');
  });
});
