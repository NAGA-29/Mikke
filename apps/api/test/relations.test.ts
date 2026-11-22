import { describe, expect, it } from 'vitest';
import { call, create, ok, pool } from './helpers.js';

describe('relations (MVP受け入れ基準3)', () => {
  it('registers API→PostgreSQL / API→Redis / API→SQS / Worker→SQS with direction and type', async () => {
    const api = await create.app('api');
    const worker = await create.app('worker');
    const pg = await create.service('postgres', { service_kind: 'database' });
    const redis = await create.service('redis', { service_kind: 'cache' });
    const sqs = await create.service('jobs-queue', { service_kind: 'queue', engine: 'SQS', provider: 'AWS', is_managed: true });

    for (const [s, t, type] of [
      [api, pg, 'connects_to'],
      [api, redis, 'uses'],
      [api, sqs, 'publishes_to'],
      [worker, sqs, 'consumes_from'],
    ] as const) {
      await ok('POST', '/relations', { body: { source_resource_id: s.id, target_resource_id: t.id, relation_type: type } });
    }

    const out = await ok('GET', `/relations?resource_id=${api.id}&direction=out`);
    expect(out.map((r: any) => `${r.relation_type}:${r.target_name}`).sort()).toEqual([
      'connects_to:postgres',
      'publishes_to:jobs-queue',
      'uses:redis',
    ]);
    const toSqs = await ok('GET', `/relations?resource_id=${sqs.id}&direction=in`);
    expect(toSqs.map((r: any) => `${r.source_name}:${r.relation_type}`).sort()).toEqual([
      'api:publishes_to',
      'worker:consumes_from',
    ]);
  });

  it('rejects self relations, duplicates, derived and unknown types', async () => {
    const a = await create.app('a');
    const b = await create.app('b');
    expect((await call('POST', '/relations', { body: { source_resource_id: a.id, target_resource_id: a.id, relation_type: 'uses' } })).status).toBe(422);
    await ok('POST', '/relations', { body: { source_resource_id: a.id, target_resource_id: b.id, relation_type: 'uses' } });
    expect((await call('POST', '/relations', { body: { source_resource_id: a.id, target_resource_id: b.id, relation_type: 'uses' } })).status).toBe(409);
    expect((await call('POST', '/relations', { body: { source_resource_id: a.id, target_resource_id: b.id, relation_type: 'hosted_on' } })).status).toBe(422);
  });

  it('deleting a relation cleans up diagram hidden-edge entries and is audited', async () => {
    const a = await create.app('a');
    const b = await create.app('b');
    const rel = await ok('POST', '/relations', { body: { source_resource_id: a.id, target_resource_id: b.id, relation_type: 'depends_on' } });
    const { rows } = await pool.query(`INSERT INTO diagrams (name) VALUES ('d') RETURNING id`);
    await pool.query(`INSERT INTO diagram_hidden_edges (diagram_id, edge_kind, edge_record_id) VALUES ($1, 'relation', $2)`, [rows[0].id, rel.id]);

    expect((await call('DELETE', `/relations/${rel.id}`)).status).toBe(204);
    const left = await pool.query('SELECT count(*)::int AS n FROM diagram_hidden_edges');
    expect(left.rows[0].n).toBe(0);
    const logs = await ok('GET', `/audit-logs?entity_type=resource_relation&entity_id=${rel.id}`);
    expect(logs.map((l: any) => l.action)).toEqual(['delete', 'create']);
  });
});

describe('deployments (MVP受け入れ基準2)', () => {
  it('manages multiple deployments of one app to prod and stg', async () => {
    const app = await create.app('web');
    const repo = await create.repo('web', 'https://github.com/example-org/web');
    const prod1 = await create.compute('prod-1');
    const prod2 = await create.compute('prod-2');
    const stg = await create.compute('stg-1');
    await ok('POST', '/application-repositories', { body: { application_id: app.id, repository_id: repo.id } });

    for (const [target, env] of [
      [prod1, 'prod'],
      [prod2, 'prod'],
      [stg, 'stg'],
    ] as const) {
      await ok('POST', '/deployments', {
        body: { application_id: app.id, target_resource_id: target.id, repository_id: repo.id, environment: env, revision: 'abc123' },
      });
    }
    expect(await ok('GET', `/deployments?application_id=${app.id}&environment=prod`)).toHaveLength(2);
    const all = await ok('GET', `/deployments?application_id=${app.id}`);
    expect(all).toHaveLength(3);

    const updated = await ok('PATCH', `/deployments/${all[0].id}`, { body: { revision: 'def456', status: 'inactive' } });
    expect(updated.revision).toBe('def456');
    expect(updated.status).toBe('inactive');
  });

  it('validates deployment targets and repository linkage', async () => {
    const app = await create.app('web');
    const db = await create.service('db', { service_kind: 'database' });
    const hosting = await create.service('cloud-run', { service_kind: 'hosting', engine: 'Cloud Run', is_managed: true });
    const repo = await create.repo('web', 'https://github.com/example-org/web');
    const other = await create.app('other');

    const bad = await call('POST', '/deployments', { body: { application_id: app.id, target_resource_id: db.id, environment: 'prod' } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('invalid_deployment_target');
    await ok('POST', '/deployments', { body: { application_id: app.id, target_resource_id: hosting.id, environment: 'prod' } });
    expect((await call('POST', '/deployments', { body: { application_id: app.id, target_resource_id: other.id, environment: 'prod' } })).status).toBe(422);

    const unlinked = await call('POST', '/deployments', {
      body: { application_id: app.id, target_resource_id: hosting.id, repository_id: repo.id, environment: 'prod' },
    });
    expect(unlinked.body.error.code).toBe('repository_not_linked');
  });

  it('allows deactivating a deployment whose repository is archived when the same repository_id is resent', async () => {
    const app = await create.app('web');
    const repo = await create.repo('web', 'https://github.com/example-org/web');
    const vps = await create.compute('vps');
    await ok('POST', '/application-repositories', { body: { application_id: app.id, repository_id: repo.id } });
    const d = await ok('POST', '/deployments', { body: { application_id: app.id, target_resource_id: vps.id, repository_id: repo.id, environment: 'prod' } });
    await ok('POST', `/resources/${repo.id}/archive`, { as: 'admin' });
    const r = await ok('PATCH', `/deployments/${d.id}`, { body: { status: 'inactive', repository_id: repo.id } });
    expect(r.status).toBe('inactive');
  });

  it('refuses to unlink a repository still used by deployments', async () => {
    const app = await create.app('web');
    const repo = await create.repo('web', 'https://github.com/example-org/web');
    const vps = await create.compute('vps');
    const link = await ok('POST', '/application-repositories', { body: { application_id: app.id, repository_id: repo.id } });
    await ok('POST', '/deployments', { body: { application_id: app.id, target_resource_id: vps.id, repository_id: repo.id, environment: 'prod' } });
    const r = await call('DELETE', `/application-repositories/${link.id}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('link_in_use');
  });
});
