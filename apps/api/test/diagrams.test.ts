import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { withTx } from '../src/db/pool.js';
import { createNode } from '../src/services/diagrams.js';
import { call, create, ok, pool } from './helpers.js';

const diagram = (name = 'system') => ok('POST', '/diagrams', { body: { name } });
const place = (d: string, r: string) =>
  ok('POST', `/diagrams/${d}/nodes`, {
    body: { resource_id: r, position_x: 10, position_y: -20 },
  });
const graph = (d: string) => ok('GET', `/graph?diagram_id=${d}`);
const hide = (d: string, kind: string, id: string) =>
  ok('POST', `/diagrams/${d}/hidden-edges`, {
    body: { edge_kind: kind, edge_record_id: id },
  });
const logs = (type: string, id: string) => ok('GET', `/audit-logs?entity_type=${type}&entity_id=${id}`);
const missing = '00000000-0000-4000-8000-000000000001';

async function fixture() {
  const a = await create.app('api');
  const c = await create.compute('host');
  const s = await create.service('db', { service_kind: 'database', host_compute_id: c.id });
  const r = await create.repo('source', 'https://github.com/example-org/api');
  const relation = await ok('POST', '/relations', {
    body: {
      source_resource_id: a.id,
      target_resource_id: s.id,
      relation_type: 'uses',
    },
  });
  const link = await ok('POST', '/application-repositories', { body: { application_id: a.id, repository_id: r.id } });
  const deployment = await ok('POST', '/deployments', {
    body: {
      application_id: a.id,
      target_resource_id: c.id,
      environment: 'prod',
      repository_id: r.id,
    },
  });
  return { a, c, s, r, relation, link, deployment };
}

describe('diagram CRUD', () => {
  it('creates, reads, updates and deletes display data without deleting resources; audits changes', async () => {
    const a = await create.app('api');
    const d = await diagram();
    expect((await ok('GET', '/diagrams')).map((v: any) => v.id)).toEqual([d.id]);
    expect(await ok('GET', `/diagrams/${d.id}`)).toEqual(d);
    const updated = await ok('PATCH', `/diagrams/${d.id}`, {
      body: {
        name: 'renamed',
        description: 'diagram',
        viewport: { x: -1, y: 2, zoom: 0.5 },
      },
    });
    expect(updated).toMatchObject({ name: 'renamed', viewport: { x: -1, y: 2, zoom: 0.5 } });
    const n = await place(d.id, a.id);
    expect(await ok('GET', `/diagrams/${d.id}/nodes/${n.id}`)).toEqual(n);
    expect(await ok('GET', `/diagrams/${d.id}/nodes`)).toEqual([n]);
    const moved = await ok('PATCH', `/diagrams/${d.id}/nodes/${n.id}`, {
      body: {
        position_x: -0.25,
        position_y: 3.75,
        display_options: { collapsed: true },
      },
    });
    expect(moved).toMatchObject({ position_x: -0.25, position_y: 3.75, display_options: { collapsed: true } });
    await ok('DELETE', `/diagrams/${d.id}/nodes/${n.id}`);
    expect((await graph(d.id)).nodes).toEqual([]);
    const nl = await logs('diagram_node', n.id);
    expect(nl.map((v: any) => v.action).sort()).toEqual(['create', 'delete', 'update']);
    expect(nl.find((v: any) => v.action === 'update')).toMatchObject({
      actor_id: 'test:writer',
      before_data: { position_x: 10 },
      after_data: { position_x: -0.25 },
    });
    await place(d.id, a.id);
    await ok('DELETE', `/diagrams/${d.id}`);
    expect((await call('GET', `/diagrams/${d.id}`)).status).toBe(404);
    expect((await call('GET', `/graph?diagram_id=${d.id}`)).status).toBe(404);
    expect((await ok('GET', `/resources/${a.id}`)).archived_at).toBeNull();
    expect((await pool.query('SELECT * FROM diagram_nodes')).rows).toEqual([]);
    const dl = await logs('diagram', d.id);
    expect(dl.map((v: any) => v.action).sort()).toEqual(['create', 'delete', 'update']);
    expect(dl.find((v: any) => v.action === 'delete').before_data.nodes).toHaveLength(1);
  });

  it('rolls back a placement and its audit together when the transaction fails', async () => {
    const a = await create.app('api');
    const d = await diagram();
    let nodeId = '';
    await expect(
      withTx(pool, async (tx) => {
        const n = await createNode(tx, { id: 'test:writer', scopes: new Set(['mikke:write']) }, d.id, {
          resource_id: a.id,
          position_x: 1,
          position_y: 2,
        });
        nodeId = n.id;
        expect((await tx.query('SELECT * FROM audit_logs WHERE entity_id = $1', [nodeId])).rows).toHaveLength(1);
        throw new Error('abort transaction');
      }),
    ).rejects.toThrow('abort transaction');
    expect((await graph(d.id)).nodes).toEqual([]);
    expect(await logs('diagram_node', nodeId)).toEqual([]);
  });

  it('validates strict input, references, uniqueness and diagram ownership without auditing rejected writes', async () => {
    const a = await create.app('api');
    const d = await diagram();
    const other = await diagram('other');
    const n = await place(d.id, a.id);
    expect((await call('POST', '/diagrams', { body: { name: 'bad', extra: true } })).status).toBe(422);
    expect((await call('PATCH', `/diagrams/${d.id}`, { body: { viewport: { x: 0, y: 0, zoom: 0 } } })).status).toBe(422);
    expect((await call('POST', `/diagrams/${d.id}/nodes`, { body: { resource_id: a.id, position_x: 0, position_y: 0 } })).status).toBe(409);
    expect((await call('POST', `/diagrams/${d.id}/nodes`, { body: { resource_id: missing, position_x: 0, position_y: 0 } })).status).toBe(
      404,
    );
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      expect(
        (await call(method, `/diagrams/${other.id}/nodes/${n.id}`, method === 'PATCH' ? { body: { position_x: 1 } } : {})).status,
      ).toBe(404);
    }
    expect((await call('PATCH', `/diagrams/${d.id}/nodes/${n.id}`, { body: { resource_id: a.id } })).status).toBe(422);
    expect(
      (await call('PATCH', `/diagrams/${d.id}/nodes/${n.id}`, { body: { display_options: { nested: { token: 'secret' } } } })).status,
    ).toBe(422);
    expect(await logs('diagram_node', n.id)).toHaveLength(1);
    expect((await call('GET', '/graph')).status).toBe(422);
    expect((await call('GET', '/graph?diagram_id=invalid')).status).toBe(422);
    expect((await call('GET', `/graph?diagram_id=${d.id}&extra=1`)).status).toBe(422);
  });
});

describe('graph source of truth', () => {
  it('derives all four edge kinds with IDs, directions, labels and metadata; requires both endpoints', async () => {
    const f = await fixture();
    const d = await diagram();
    expect(await graph(d.id)).toMatchObject({ nodes: [], edges: [] });
    await place(d.id, f.a.id);
    expect((await graph(d.id)).edges).toEqual([]);
    await place(d.id, f.s.id);
    expect((await graph(d.id)).edges.map((e: any) => e.edge_kind)).toEqual(['relation']);
    const hostNode = await place(d.id, f.c.id);
    await place(d.id, f.r.id);
    const g = await graph(d.id);
    expect(g.nodes).toHaveLength(4);
    // 形状の出し分け用の細分類。サービスは service_kind、コンピュートは asset_kind、それ以外は null
    const kindOf = (id: string) => g.nodes.find((n: any) => n.resource_id === id).kind;
    expect(kindOf(f.s.id)).toBe('database');
    expect(kindOf(f.c.id)).toEqual(expect.any(String));
    expect(kindOf(f.a.id)).toBeNull();
    expect(kindOf(f.r.id)).toBeNull();
    expect(g.edges).toEqual([
      expect.objectContaining({
        edge_kind: 'app_repository',
        edge_record_id: f.link.id,
        source_resource_id: f.a.id,
        target_resource_id: f.r.id,
        label: 'sourced_from',
        details: { purpose: 'source' },
      }),
      expect.objectContaining({
        edge_kind: 'deployment',
        edge_record_id: f.deployment.id,
        source_resource_id: f.a.id,
        target_resource_id: f.c.id,
        label: 'deployed_on',
        details: { environment: 'prod', status: 'active', revision: null },
      }),
      expect.objectContaining({
        edge_kind: 'hosting',
        edge_record_id: f.s.id,
        source_resource_id: f.s.id,
        target_resource_id: f.c.id,
        label: 'hosted_on',
      }),
      expect.objectContaining({
        edge_kind: 'relation',
        edge_record_id: f.relation.id,
        source_resource_id: f.a.id,
        target_resource_id: f.s.id,
        label: 'uses',
      }),
    ]);
    await ok('PATCH', `/deployments/${f.deployment.id}`, { body: { status: 'inactive' } });
    expect((await graph(d.id)).edges.find((e: any) => e.edge_kind === 'deployment').details.status).toBe('inactive');
    await ok('DELETE', `/diagrams/${d.id}/nodes/${hostNode.id}`);
    expect((await graph(d.id)).edges.map((e: any) => e.edge_kind)).toEqual(['app_repository', 'relation']);
    expect(await ok('GET', `/deployments/${f.deployment.id}`)).toMatchObject({ status: 'inactive' });
  });

  it('hides each kind only on the specified diagram, unhides idempotently, and records actual changes', async () => {
    const f = await fixture();
    const ds = [await diagram('one'), await diagram('two')];
    for (const d of ds) for (const r of [f.a, f.c, f.s, f.r]) await place(d.id, r.id);
    const edges = (await graph(ds[0].id)).edges;
    for (const e of edges) {
      await hide(ds[0].id, e.edge_kind, e.edge_record_id);
      await hide(ds[0].id, e.edge_kind, e.edge_record_id);
    }
    expect((await graph(ds[0].id)).edges).toEqual([]);
    expect((await graph(ds[1].id)).edges).toHaveLength(4);
    expect(await ok('GET', `/diagrams/${ds[0].id}/hidden-edges`)).toHaveLength(4);
    expect(await logs('diagram_hidden_edge', ds[0].id)).toHaveLength(4);
    for (const e of edges) {
      const path = `/diagrams/${ds[0].id}/hidden-edges/${e.edge_kind}/${e.edge_record_id}`;
      await ok('DELETE', path);
      await ok('DELETE', path);
    }
    expect((await graph(ds[0].id)).edges).toHaveLength(4);
    const hl = await logs('diagram_hidden_edge', ds[0].id);
    expect(hl).toHaveLength(8);
    expect(hl.every((l: any) => l.actor_id === 'test:writer')).toBe(true);
    expect(hl.find((l: any) => l.action === 'delete').before_data).toHaveProperty('edge_record_id');
    for (const kind of ['relation', 'deployment', 'hosting', 'app_repository']) {
      expect(
        (await call('POST', `/diagrams/${ds[0].id}/hidden-edges`, { body: { edge_kind: kind, edge_record_id: missing } })).status,
      ).toBe(404);
    }
    expect(
      (await call('POST', `/diagrams/${ds[0].id}/hidden-edges`, { body: { edge_kind: 'unknown', edge_record_id: f.a.id } })).status,
    ).toBe(422);
    expect(
      (await call('POST', `/diagrams/${ds[0].id}/hidden-edges`, { body: { edge_kind: 'hosting', edge_record_id: f.c.id } })).status,
    ).toBe(422);
  });

  it('retains archived nodes and edges, permits moving/removing existing placements, rejects new placement', async () => {
    const f = await fixture();
    const d = await diagram();
    const n = await place(d.id, f.s.id);
    await place(d.id, f.c.id);
    await ok('POST', `/resources/${f.s.id}/archive`, { as: 'admin' });
    const g = await graph(d.id);
    expect(g.nodes.find((r: any) => r.resource_id === f.s.id)).toMatchObject({ archived: true, archived_at: expect.any(String) });
    expect(g.nodes.find((r: any) => r.resource_id === f.c.id).archived).toBe(false);
    expect(g.edges).toHaveLength(1);
    await hide(d.id, 'hosting', f.s.id);
    await ok('PATCH', `/diagrams/${d.id}/nodes/${n.id}`, { body: { position_x: 123 } });
    await ok('DELETE', `/diagrams/${d.id}/nodes/${n.id}`);
    const rejected = await call('POST', `/diagrams/${d.id}/nodes`, { body: { resource_id: f.s.id, position_x: 0, position_y: 0 } });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('resource_archived');
  });

  it('updates the source APIs, cleans hidden records in every diagram, and preserves audit and assets', async () => {
    const f = await fixture();
    const ds = [await diagram(), await diagram('two')];
    for (const d of ds) {
      for (const r of [f.a, f.c, f.s, f.r]) await place(d.id, r.id);
      for (const e of (await graph(d.id)).edges) await hide(d.id, e.edge_kind, e.edge_record_id);
    }
    await ok('DELETE', `/relations/${f.relation.id}`);
    await ok('DELETE', `/deployments/${f.deployment.id}`);
    await ok('DELETE', `/application-repositories/${f.link.id}`);
    await ok('PATCH', `/resources/${f.s.id}`, { body: { detail: { host_compute_id: null } } });
    expect((await pool.query('SELECT * FROM diagram_hidden_edges')).rows).toEqual([]);
    for (const d of ds) expect((await graph(d.id)).edges).toEqual([]);
    expect((await logs('deployment', f.deployment.id)).map((l: any) => l.action).sort()).toEqual(['create', 'delete']);
    expect((await call('DELETE', `/deployments/${f.deployment.id}`)).status).toBe(404);
    expect((await ok('GET', '/resources')).items.length).toBe(4);
    // 図削除のカスケードは表示設定だけ。正本は存続する。
    const rel = await ok('POST', '/relations', { body: { source_resource_id: f.a.id, target_resource_id: f.c.id, relation_type: 'uses' } });
    await hide(ds[0].id, 'relation', rel.id);
    await ok('DELETE', `/diagrams/${ds[0].id}`);
    expect(await ok('GET', `/relations/${rel.id}`)).toMatchObject({ id: rel.id });
    expect((await logs('diagram', ds[0].id)).find((l: any) => l.action === 'delete').before_data.hidden_edges).toHaveLength(1);
  });

  it('detects orphan hidden edges for every source kind, including unhosted services', async () => {
    const f = await fixture();
    const d = await diagram();
    for (const [kind, id] of [
      ['relation', f.relation.id],
      ['deployment', f.deployment.id],
      ['hosting', f.s.id],
      ['app_repository', f.link.id],
    ]) {
      await hide(d.id, kind!, id!);
    }
    const sql = await readFile(new URL('../../../db/checks/orphan_diagram_hidden_edges.sql', import.meta.url), 'utf8');
    expect((await pool.query(sql)).rows).toEqual([]);
    // APIを通さない破損を模擬し、検査SQL自体を検証。
    for (const kind of ['relation', 'deployment', 'hosting', 'app_repository']) {
      await pool.query('INSERT INTO diagram_hidden_edges (diagram_id, edge_kind, edge_record_id) VALUES ($1, $2, $3)', [
        d.id,
        kind,
        missing,
      ]);
    }
    expect((await pool.query(sql)).rows).toHaveLength(4);
    await pool.query('UPDATE service_instances SET host_compute_id = NULL WHERE resource_id = $1', [f.s.id]);
    expect((await pool.query(sql)).rows).toHaveLength(5);
  });
});

describe('diagram and graph permissions', () => {
  it('requires authentication/read for reads and write for all mutations, including deployment deletion', async () => {
    const f = await fixture();
    const d = await diagram();
    const n = await place(d.id, f.a.id);
    for (const path of [
      '/diagrams',
      `/diagrams/${d.id}`,
      `/diagrams/${d.id}/nodes`,
      `/diagrams/${d.id}/nodes/${n.id}`,
      `/diagrams/${d.id}/hidden-edges`,
      `/graph?diagram_id=${d.id}`,
    ]) {
      expect((await call('GET', path, { as: null })).status).toBe(401);
      expect((await call('GET', path, { as: 'reader' })).status).toBe(200);
    }
    for (const [method, path, body] of [
      ['POST', '/diagrams', { name: 'denied' }],
      ['PATCH', `/diagrams/${d.id}`, { name: 'denied' }],
      ['DELETE', `/diagrams/${d.id}`, undefined],
      ['POST', `/diagrams/${d.id}/nodes`, { resource_id: f.c.id, position_x: 0, position_y: 0 }],
      ['PATCH', `/diagrams/${d.id}/nodes/${n.id}`, { position_x: 0 }],
      ['DELETE', `/diagrams/${d.id}/nodes/${n.id}`, undefined],
      ['POST', `/diagrams/${d.id}/hidden-edges`, { edge_kind: 'relation', edge_record_id: f.relation.id }],
      ['DELETE', `/diagrams/${d.id}/hidden-edges/relation/${f.relation.id}`, undefined],
      [
        'PUT',
        `/diagrams/${d.id}/edge-styles`,
        { edge_kind: 'relation', edge_record_id: f.relation.id, line_style: 'wavy', arrow_style: 'open' },
      ],
      ['DELETE', `/diagrams/${d.id}/edge-styles/relation/${f.relation.id}`, undefined],
      ['DELETE', `/deployments/${f.deployment.id}`, undefined],
    ] as const) {
      expect((await call(method, path, { as: 'reader', body })).status).toBe(403);
    }
    expect(await logs('diagram', d.id)).toHaveLength(1);
    expect((await call('POST', '/diagrams', { as: 'admin', body: { name: 'admin' } })).status).toBe(201);
  });
});

describe('edge styles (per-diagram display override)', () => {
  const put = (d: string, kind: string, id: string, line_style = 'wavy', arrow_style = 'open') =>
    call('PUT', `/diagrams/${d}/edge-styles`, { body: { edge_kind: kind, edge_record_id: id, line_style, arrow_style } });
  const relationStyle = async (d: string, id: string) => (await graph(d)).edges.find((e: any) => e.edge_record_id === id).style;

  it('overrides only the given diagram, upserts, resets, and audits; canonical data is untouched', async () => {
    const f = await fixture();
    const [d1, d2] = [await diagram('one'), await diagram('two')];
    for (const d of [d1, d2]) {
      await place(d.id, f.a.id);
      await place(d.id, f.s.id);
    }
    expect(await relationStyle(d1.id, f.relation.id)).toBeNull();

    expect((await put(d1.id, 'relation', f.relation.id)).status).toBe(200);
    expect(await relationStyle(d1.id, f.relation.id)).toEqual({ line_style: 'wavy', arrow_style: 'open' });
    expect(await relationStyle(d2.id, f.relation.id)).toBeNull();

    await put(d1.id, 'relation', f.relation.id, 'dotted', 'none');
    expect(await relationStyle(d1.id, f.relation.id)).toEqual({ line_style: 'dotted', arrow_style: 'none' });
    expect(await ok('GET', `/diagrams/${d1.id}/edge-styles`)).toHaveLength(1);

    // 正本の関係は変わらない
    expect((await graph(d1.id)).edges.find((e: any) => e.edge_record_id === f.relation.id).label).toBe('uses');

    expect((await call('DELETE', `/diagrams/${d1.id}/edge-styles/relation/${f.relation.id}`)).status).toBe(204);
    expect(await relationStyle(d1.id, f.relation.id)).toBeNull();
    expect((await call('DELETE', `/diagrams/${d1.id}/edge-styles/relation/${f.relation.id}`)).status).toBe(204);
    expect((await logs('diagram_edge_style', d1.id)).map((l: any) => l.action)).toEqual(['delete', 'update', 'create']);
  });

  it('validates input and the canonical edge', async () => {
    const f = await fixture();
    const d = await diagram();
    expect((await put(d.id, 'relation', f.relation.id, 'zigzag')).status).toBe(422);
    expect((await put(d.id, 'relation', f.relation.id, 'solid', 'big')).status).toBe(422);
    expect((await put(d.id, 'bogus', f.relation.id)).status).toBe(422);
    expect((await put(d.id, 'relation', missing)).status).toBe(404);
    expect((await put(missing, 'relation', f.relation.id)).status).toBe(404);
    expect(
      (
        await call('PUT', `/diagrams/${d.id}/edge-styles`, {
          body: { edge_kind: 'relation', edge_record_id: f.relation.id, line_style: 'solid', arrow_style: 'open', extra: 1 },
        })
      ).status,
    ).toBe(422);
  });

  it('is removed with the diagram and recorded in its audit trail', async () => {
    const f = await fixture();
    const d = await diagram();
    await put(d.id, 'relation', f.relation.id);
    await ok('DELETE', `/diagrams/${d.id}`);
    expect((await pool.query('SELECT 1 FROM diagram_edge_styles WHERE diagram_id = $1', [d.id])).rowCount).toBe(0);
    const del = (await logs('diagram', d.id)).find((l: any) => l.action === 'delete');
    expect(del.before_data.edge_styles).toHaveLength(1);
  });
});
