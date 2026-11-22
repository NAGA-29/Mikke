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
  test('資産の細分類ごとに形状が変わり、関係の種類ごとに線種・矢印が変わる', async ({ page, request }, testInfo) => {
    const mk = (body: Record<string, unknown>) => seedResource(request, { name: unique('shape'), ...body });
    const host = await mk({ resource_type: 'compute', detail: { asset_kind: 'vps' } });
    const app = await mk({ resource_type: 'application', detail: {} });
    const repo = await mk({ resource_type: 'repository', detail: { provider: 'github', repository_url: 'https://github.com/example-org/shape' } });
    const svc = (service_kind: string) => mk({ resource_type: 'service_instance', detail: { service_kind } });
    const [db, cache, queue, storage, hosting] = [await svc('database'), await svc('cache'), await svc('queue'), await svc('storage'), await svc('hosting')];
    const diagram = await api(request, 'POST', '/diagrams', { name: unique('shapes') });
    const all = [host, app, repo, db, cache, queue, storage, hosting];
    for (const [i, r] of all.entries()) {
      const n = await api(request, 'POST', `/diagrams/${diagram.body.id}/nodes`, { resource_id: r.id, position_x: (i % 4) * 300, position_y: Math.floor(i / 4) * 220 });
      expect(n.status, JSON.stringify(n.body)).toBe(201);
    }
    for (const [target, type] of [[db, 'connects_to'], [cache, 'uses'], [queue, 'publishes_to'], [storage, 'depends_on']] as const) {
      const rel = await api(request, 'POST', '/relations', { source_resource_id: app.id, target_resource_id: target.id, relation_type: type });
      expect(rel.status, JSON.stringify(rel.body)).toBe(201);
    }
    await loginOk(page);
    await page.goto(`/diagrams/${diagram.body.id}`);
    const shapeOf = (r: { id: string }) => page.locator(`.react-flow__node[data-id="${r.id}"] .asset-node`).getAttribute('data-shape');
    expect(await Promise.all([host, app, repo, db, cache, queue, storage, hosting].map(shapeOf)))
      .toEqual(['server', 'pill', 'folder', 'cylinder', 'hexagon', 'parallelogram', 'cylinder', 'double']);
    await expect(page.locator('.react-flow__edge')).toHaveCount(4);
    // 波線は折れ線（L コマンド）で描かれ、実線の接続は曲線（C コマンド）のまま
    const dOf = (type: string) => page.locator('.react-flow__edge').filter({ hasText: type }).locator('path.react-flow__edge-path').getAttribute('d');
    expect(await dOf('publishes_to')).toContain(' L ');
    expect(await dOf('connects_to')).not.toContain(' L ');
    await expect(page.getByLabel('凡例')).toBeVisible();
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/canvas-shapes.png`, fullPage: true });
    void testInfo;
  });
});
