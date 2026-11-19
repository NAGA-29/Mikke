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
    const r = await call('POST', '/resources', {
      body: {
        resource_type: 'service_instance',
        name: 'orphan',
        detail: { service_kind: 'database', host_compute_id: '00000000-0000-4000-8000-000000000000' },
      },
    });
    expect(r.status).toBe(404);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM resources WHERE name = 'orphan'`);
    expect(rows[0].n).toBe(0);
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
  });

  it('enforces resource_type/detail consistency at the DB level', async () => {
    const app = await create.app('api');
    await expect(
      pool.query(`INSERT INTO compute_assets (resource_id, asset_kind) VALUES ($1, 'vps')`, [app.id]),
    ).rejects.toThrow(/foreign key/);
  });

  it('normalizes and deduplicates repository URLs', async () => {
    expect(normalizeRepositoryUrl('git@github.com:PLUS9/Mikke.git')).toBe('https://github.com/PLUS9/Mikke');
    expect(normalizeRepositoryUrl('https://GitHub.com/PLUS9/Mikke/')).toBe('https://github.com/PLUS9/Mikke');
    expect(normalizeRepositoryUrl('https://git.example.com:8443/team/repo.git')).toBe('https://git.example.com:8443/team/repo');
    expect(normalizeRepositoryUrl('https://github.com:443/team/repo')).toBe('https://github.com/team/repo');
    expect(normalizeRepositoryUrl('ssh://git@git.example.com:2222/team/repo.git')).toBe('https://git.example.com/team/repo');
    await create.repo('mikke', 'https://github.com/plus9/mikke.git');
    const dup = await call('POST', '/resources', {
      body: { resource_type: 'repository', name: 'dup', detail: { repository_url: 'git@github.com:plus9/mikke.git' } },
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
