import { describe, expect, it } from 'vitest';
import { normalizeRepositoryUrl } from '../src/services/resources.js';
import { call, create, ok, pool } from './helpers.js';

describe('auth', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await call('GET', '/resources', { as: null })).status).toBe(401);
  });
  it('rejects writes without mikke:write', async () => {
    const r = await call('POST', '/resources', {
      as: 'reader',
      body: { resource_type: 'application', name: 'x', detail: {} },
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('insufficient_scope');
  });
});

describe('resources', () => {
  it('registers PostgreSQL and Redis on one VPS as separate service instances (MVP受け入れ基準1)', async () => {
    const vps = await create.compute('sakura-vps-01', { hostname: 'vps01', provider: 'Sakura', public_ip: '203.0.113.10' });
    const pg = await create.service('postgres-main', { service_kind: 'database', engine: 'PostgreSQL', engine_version: '18.1', host_compute_id: vps.id });
    const redis = await create.service('redis-cache', { service_kind: 'cache', engine: 'Redis', engine_version: '7.4.2', host_compute_id: vps.id });
    expect(pg.id).not.toBe(redis.id);
    expect(pg.detail.host_compute_id).toBe(vps.id);

    const refs = await ok('GET', `/resources/${vps.id}/references`);
    expect(refs.hosted_services.map((s: any) => s.name).sort()).toEqual(['postgres-main', 'redis-cache']);

    const list = await ok('GET', '/resources?type=service_instance');
    expect(list.items).toHaveLength(2);
  });

  it('creates the common row and detail in one transaction (detail failure rolls back)', async () => {
    await create.repo('first', 'https://github.com/example-org/shared');
    // 共通行の INSERT 後に、詳細行の一意制約違反で失敗させる
    const r = await call('POST', '/resources', {
      body: { resource_type: 'repository', name: 'orphan', detail: { repository_url: 'git@github.com:example-org/shared.git' } },
    });
    expect(r.status).toBe(409);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM resources WHERE name = 'orphan'`);
    expect(rows[0].n).toBe(0);
    const audit = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE after_data->>'name' = 'orphan'`);
    expect(audit.rows[0].n).toBe(0);
  });

  it('rejects credentials in attributes and endpoint', async () => {
    const a = await call('POST', '/resources', {
      body: { resource_type: 'application', name: 'a', detail: { attributes: { db: { password: 'x' } } } },
    });
    expect(a.status).toBe(422);
    const b = await call('POST', '/resources', {
      body: { resource_type: 'service_instance', name: 'b', detail: { service_kind: 'database', endpoint: 'postgres://u:p@db:5432/x' } },
    });
    expect(b.status).toBe(422);
    for (const ep of ['https://db.example/?access_token=x', 'https://db.example/?api_key=x', 'https://db.example/?%70assword=x']) {
      const r = await call('POST', '/resources', {
        body: { resource_type: 'service_instance', name: 'c', detail: { service_kind: 'database', endpoint: ep } },
      });
      expect(r.status, ep).toBe(422);
    }
    await create.service('ok', { service_kind: 'database', endpoint: 'db.internal:5432' });
    await create.service('ok2', { service_kind: 'database', endpoint: 'postgres://db.internal:5432/app?sslmode=require' });
  });

  it('enforces resource_type/detail consistency at the DB level', async () => {
    const app = await create.app('api');
    await expect(
      pool.query(`INSERT INTO compute_assets (resource_id, asset_kind) VALUES ($1, 'vps')`, [app.id]),
    ).rejects.toThrow(/foreign key/);
  });

  it('normalizes and deduplicates repository URLs', async () => {
    expect(normalizeRepositoryUrl('git@github.com:Example-Org/Mikke.git')).toBe('https://github.com/Example-Org/Mikke');
    expect(normalizeRepositoryUrl('https://GitHub.com/Example-Org/Mikke/')).toBe('https://github.com/Example-Org/Mikke');
    expect(normalizeRepositoryUrl('https://git.example.com:8443/team/repo.git')).toBe('https://git.example.com:8443/team/repo');
    expect(normalizeRepositoryUrl('https://github.com:443/team/repo')).toBe('https://github.com/team/repo');
    expect(normalizeRepositoryUrl('ssh://git@git.example.com:2222/team/repo.git')).toBe('https://git.example.com/team/repo');
    await create.repo('mikke', 'https://github.com/example-org/mikke.git');
    const dup = await call('POST', '/resources', {
      body: { resource_type: 'repository', name: 'dup', detail: { repository_url: 'git@github.com:example-org/mikke.git' } },
    });
    expect(dup.status).toBe(409);
  });

  it('updates detail fields and records before/after in audit_logs', async () => {
    const vps = await create.compute('vps', { os_name: 'Ubuntu', os_version: '22.04' });
    const updated = await ok('PATCH', `/resources/${vps.id}`, { body: { lifecycle_status: 'maintenance', detail: { os_version: '24.04' } } });
    expect(updated.lifecycle_status).toBe('maintenance');
    expect(updated.detail.os_version).toBe('24.04');
    expect(updated.detail.asset_kind).toBe('vps');

    const logs = await ok('GET', `/audit-logs?entity_type=resource&entity_id=${vps.id}`);
    expect(logs.map((l: any) => l.action)).toEqual(['update', 'create']);
    expect(logs[0].actor_id).toBe('test:writer');
    expect(logs[0].before_data.detail.os_version).toBe('22.04');
    expect(logs[0].after_data.detail.os_version).toBe('24.04');
  });

  it('refuses to change service_kind away from hosting while deployments target it', async () => {
    const app = await create.app('web');
    const run = await create.service('cloud-run', { service_kind: 'hosting', is_managed: true });
    await ok('POST', '/deployments', { body: { application_id: app.id, target_resource_id: run.id, environment: 'prod' } });
    const r = await call('PATCH', `/resources/${run.id}`, { body: { detail: { service_kind: 'database' } } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('hosting_in_use');
    await ok('PATCH', `/resources/${run.id}`, { body: { detail: { engine: 'Cloud Run' } } });
  });

  it('rejects detail fields of another resource type', async () => {
    const app = await create.app('api');
    const r = await call('PATCH', `/resources/${app.id}`, { body: { detail: { hostname: 'x' } } });
    expect(r.status).toBe(422);
  });
});

describe('archive / restore (MVP受け入れ基準6)', () => {
  it('keeps relations, deployments and audit logs when archiving a referenced resource', async () => {
    const vps = await create.compute('vps');
    const api = await create.app('api');
    const redis = await create.service('redis', { service_kind: 'cache', host_compute_id: vps.id });
    await ok('POST', '/relations', { body: { source_resource_id: api.id, target_resource_id: redis.id, relation_type: 'uses' } });
    await ok('POST', '/deployments', { body: { application_id: api.id, target_resource_id: vps.id, environment: 'prod' } });

    expect((await call('POST', `/resources/${redis.id}/archive`)).status).toBe(403); // writer では不可

    const archived = await ok('POST', `/resources/${redis.id}/archive`, { as: 'admin' });
    expect(archived.resource.archived_at).not.toBeNull();
    expect(archived.references.relations_in).toHaveLength(1);

    // 関係は残り、アーカイブ済みの端点として判別できる
    const rels = await ok('GET', `/relations?resource_id=${api.id}`);
    expect(rels).toHaveLength(1);
    expect(rels[0].target_archived).toBe(true);

    // 通常一覧からは消え、include_archived で見える
    expect((await ok('GET', '/resources?type=service_instance')).items).toHaveLength(0);
    expect((await ok('GET', '/resources?type=service_instance&include_archived=true')).items).toHaveLength(1);

    // アーカイブ済みへの新規関係・更新は拒否
    const r = await call('POST', '/relations', { body: { source_resource_id: api.id, target_resource_id: redis.id, relation_type: 'depends_on' } });
    expect(r.status).toBe(409);
    expect((await call('PATCH', `/resources/${redis.id}`, { body: { name: 'x' } })).status).toBe(409);

    const restored = await ok('POST', `/resources/${redis.id}/restore`, { as: 'admin' });
    expect(restored.archived_at).toBeNull();

    const logs = await ok('GET', `/audit-logs?entity_id=${redis.id}`);
    expect(logs.map((l: any) => l.action)).toEqual(['restore', 'archive', 'create']);
    expect(logs[1].actor_id).toBe('test:admin');
  });
});

describe('resource summary（一覧のサマリー用の件数）', () => {
  it('counts active/archived per type, including types with zero rows', async () => {
    expect(await ok('GET', '/resources/summary')).toEqual({
      by_type: {
        compute: { active: 0, archived: 0 }, application: { active: 0, archived: 0 },
        service_instance: { active: 0, archived: 0 }, repository: { active: 0, archived: 0 },
      },
      total: { active: 0, archived: 0 },
    });

    await create.compute('vps-a');
    await create.compute('vps-b');
    const app = await create.app('portal');
    await create.repo('web', 'https://github.com/example-org/web');
    await ok('POST', `/resources/${app.id}/archive`, { as: 'admin' });

    const s = await ok('GET', '/resources/summary');
    expect(s.by_type.compute).toEqual({ active: 2, archived: 0 });
    expect(s.by_type.application).toEqual({ active: 0, archived: 1 });
    expect(s.by_type.repository).toEqual({ active: 1, archived: 0 });
    expect(s.total).toEqual({ active: 3, archived: 1 });
  });

  it('requires authentication and is not shadowed by /resources/:id', async () => {
    expect((await call('GET', '/resources/summary', { as: 'none' })).status).toBe(401);
  });
});

describe('resource list pagination（総件数と切り詰めの検知）', () => {
  it('returns total for the current filters, independent of limit/offset', async () => {
    for (const n of ['a', 'b', 'c', 'd', 'e']) await create.compute(`host-${n}`);
    await create.app('portal');

    const page1 = await ok('GET', '/resources?type=compute&limit=2');
    expect(page1.items.map((r: any) => r.name)).toEqual(['host-a', 'host-b']);
    expect(page1).toMatchObject({ total: 5, limit: 2, offset: 0 });

    const page3 = await ok('GET', '/resources?type=compute&limit=2&offset=4');
    expect(page3.items.map((r: any) => r.name)).toEqual(['host-e']);
    expect(page3.total).toBe(5);

    // 絞り込みなしの総件数・アーカイブの扱いも一覧の条件に一致する
    expect((await ok('GET', '/resources?limit=1')).total).toBe(6);
    const host = page1.items[0];
    await ok('POST', `/resources/${host.id}/archive`, { as: 'admin' });
    expect((await ok('GET', '/resources?type=compute')).total).toBe(4);
    expect((await ok('GET', '/resources?type=compute&include_archived=true')).total).toBe(5);
  });
});
