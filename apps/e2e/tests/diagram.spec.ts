import { expect, test } from '@playwright/test';
import { api, loginOk, seedResource, unique } from './helpers.js';

test.describe('構成図 / Canvas', () => {
  test('図を UI から作成でき、一覧に表示される', async ({ page }) => {
    const name = unique('e2e-diagram');
    await loginOk(page);
    await page.getByTestId('nav-diagrams').click();
    await page.getByTestId('create-diagram').click();
    await page.getByRole('textbox').first().fill(name);
    await page.getByTestId('form-submit').click();
    await expect(page.getByRole('table', { name: '構成図一覧' }).getByText(name)).toBeVisible();
  });

  test('配置済みノードと、正本から組み立てたエッジが Canvas に表示される', async ({ page, request }) => {
    const app = await seedResource(request, { resource_type: 'application', name: unique('canvas-app'), detail: {} });
    const host = await seedResource(request, { resource_type: 'compute', name: unique('canvas-host'), detail: { asset_kind: 'vps' } });
    const diagram = await api(request, 'POST', '/diagrams', { name: unique('canvas') });
    expect(diagram.status).toBe(201);
    for (const [r, x] of [[app, 0], [host, 300]] as const) {
      const n = await api(request, 'POST', `/diagrams/${diagram.body.id}/nodes`, { resource_id: r.id, position_x: x, position_y: 0 });
      expect(n.status, JSON.stringify(n.body)).toBe(201);
    }
    const dep = await api(request, 'POST', '/deployments', { application_id: app.id, target_resource_id: host.id, environment: 'prod' });
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);

    await loginOk(page);
    await page.goto(`/diagrams/${diagram.body.id}`);
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await expect(page.locator('.react-flow__node').filter({ hasText: app.name })).toBeVisible();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });
});
