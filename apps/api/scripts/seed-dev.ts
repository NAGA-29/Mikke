/**
 * 開発用のサンプルデータを投入する（架空の構成。実在の社内データではない）。
 *
 *   pnpm --filter @mikke/api seed:dev
 *
 * - 書き込みは services/* 経由（監査ログの actor は seed:dev）
 * - localhost 以外のDB、資産が既にあるDBには投入しない（本番や既存データの汚染防止）
 */
import { createPool, withTx } from '../src/db/pool.js';
import type { Actor } from '../src/auth.js';
import * as resources from '../src/services/resources.js';
import * as relations from '../src/services/relations.js';
import * as deployments from '../src/services/deployments.js';
import * as software from '../src/services/software.js';
import * as diagrams from '../src/services/diagrams.js';

const url = process.env.DATABASE_URL ?? 'postgres://mikke:mikke@localhost:5432/mikke';
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error(`refusing to seed non-local database (host: ${host})`);
  process.exit(1);
}

const actor: Actor = { id: 'seed:dev', scopes: new Set(['mikke:read', 'mikke:write']) };
const pool = createPool(url);

try {
  const existing = await pool.query('SELECT count(*)::int AS n FROM resources');
  if (existing.rows[0].n > 0) {
    console.error(`resources already exist (${existing.rows[0].n}). seed skipped.`);
    process.exit(1);
  }

  await withTx(pool, async (tx) => {
    const res = (body: unknown) => resources.createResource(tx, actor, body);

    // --- コンピュート ---
    const web = await res({
      resource_type: 'compute', name: 'web-prod-01', environment: 'prod', description: 'ポータルのアプリケーションサーバー',
      detail: { asset_kind: 'ec2', hostname: 'web-prod-01.example.internal', provider: 'aws', region: 'ap-northeast-1', os_name: 'Ubuntu', os_version: '24.04', architecture: 'arm64', private_ip: '10.0.1.10' },
    });
    const db = await res({
      resource_type: 'compute', name: 'db-prod-01', environment: 'prod', description: 'PostgreSQL 専用サーバー',
      detail: { asset_kind: 'vps', hostname: 'db-prod-01.example.internal', provider: 'example-vps', region: 'tokyo', os_name: 'Ubuntu', os_version: '24.04', architecture: 'x86_64', private_ip: '10.0.2.10' },
    });
    const stg = await res({
      resource_type: 'compute', name: 'stg-01', environment: 'stg', description: '検証用の1台構成',
      detail: { asset_kind: 'vm', hostname: 'stg-01.example.internal', provider: 'on-premises', os_name: 'Ubuntu', os_version: '24.04', architecture: 'x86_64' },
    });

    // --- サービスインスタンス ---
    const pg = await res({
      resource_type: 'service_instance', name: 'portal-postgres', environment: 'prod',
      detail: { service_kind: 'database', engine: 'PostgreSQL', engine_version: '16.4', is_managed: false, host_compute_id: db.id },
    });
    const redis = await res({
      resource_type: 'service_instance', name: 'portal-redis', environment: 'prod',
      detail: { service_kind: 'cache', engine: 'Redis', engine_version: '7.2', provider: 'aws', is_managed: true },
    });

    // --- アプリケーションとリポジトリ ---
    const api = await res({
      resource_type: 'application', name: 'portal-api', environment: 'prod', description: 'ポータルの API（BFF）',
      detail: { framework: 'Hono', framework_version: '4', runtime: 'Node.js', runtime_requirement: '>=22', build_tool: 'tsc' },
    });
    const front = await res({
      resource_type: 'application', name: 'portal-web', environment: 'prod', description: 'ポータルのフロントエンド',
      detail: { framework: 'React', framework_version: '19', runtime: 'Node.js', build_tool: 'vite' },
    });
    const apiRepo = await res({
      resource_type: 'repository', name: 'portal-api (repo)',
      detail: { provider: 'github', repository_url: 'https://github.com/example-org/portal-api', default_branch: 'main' },
    });
    const webRepo = await res({
      resource_type: 'repository', name: 'portal-web (repo)',
      detail: { provider: 'github', repository_url: 'https://github.com/example-org/portal-web', default_branch: 'main' },
    });

    await relations.createApplicationRepository(tx, actor, { application_id: api.id, repository_id: apiRepo.id });
    await relations.createApplicationRepository(tx, actor, { application_id: front.id, repository_id: webRepo.id });

    // --- デプロイ ---
    await deployments.createDeployment(tx, actor, { application_id: api.id, target_resource_id: web.id, environment: 'prod', repository_id: apiRepo.id });
    await deployments.createDeployment(tx, actor, { application_id: front.id, target_resource_id: web.id, environment: 'prod', repository_id: webRepo.id });
    await deployments.createDeployment(tx, actor, { application_id: api.id, target_resource_id: stg.id, environment: 'stg', repository_id: apiRepo.id });

    // --- 依存関係 ---
    for (const [from, to, type] of [
      [api, pg, 'uses'], [api, redis, 'uses'], [front, api, 'connects_to'],
    ] as const) {
      await relations.createRelation(tx, actor, { source_resource_id: from.id, target_resource_id: to.id, relation_type: type });
    }

    // --- ソフトウェアと EOL（公式に明示されている日付のみ。出典付き） ---
    const checkedAt = new Date().toISOString();
    const node = await software.createProduct(tx, actor, { name: 'Node.js', vendor: 'OpenJS Foundation', category: 'runtime' });
    const postgres = await software.createProduct(tx, actor, { name: 'PostgreSQL', vendor: 'PostgreSQL Global Development Group', category: 'database' });
    const nodeInst = await software.createInstallation(tx, actor, { compute_asset_id: web.id, software_product_id: node.id, version: '22.11.0', install_method: 'nvm' });
    const pgInst = await software.createInstallation(tx, actor, { compute_asset_id: db.id, software_product_id: postgres.id, version: '16.4', install_method: 'apt' });

    const nodeCycle = await software.createReleaseCycle(tx, actor, {
      software_product_id: node.id, cycle: '22', assign_to: { target_kind: 'installation', target_id: nodeInst.id },
    });
    const pgCycle = await software.createReleaseCycle(tx, actor, {
      software_product_id: postgres.id, cycle: '16', assign_to: { target_kind: 'installation', target_id: pgInst.id },
    });
    await software.createLifecycleEvent(tx, actor, {
      release_cycle_id: nodeCycle.id, event_type: 'eol', event_date: '2027-04-30',
      source_url: 'https://nodejs.org/en/about/previous-releases', source_title: 'Node.js Releases', checked_at: checkedAt,
      notes: 'サンプルデータ',
    });
    await software.createLifecycleEvent(tx, actor, {
      release_cycle_id: pgCycle.id, event_type: 'eol', event_date: '2028-11-09',
      source_url: 'https://www.postgresql.org/support/versioning/', source_title: 'PostgreSQL Versioning Policy', checked_at: checkedAt,
      notes: 'サンプルデータ',
    });

    // --- 構成図 ---
    const diagram = await diagrams.createDiagram(tx, actor, { name: 'ポータル本番構成', description: 'サンプルの構成図' });
    const layout: [{ id: string }, number, number][] = [
      [front, 0, 0], [api, 280, 0], [pg, 560, -80], [redis, 560, 80], [web, 140, 200], [db, 560, 240],
    ];
    for (const [r, x, y] of layout) {
      await diagrams.createNode(tx, actor, diagram.id, { resource_id: r.id, position_x: x, position_y: y });
    }
  });

  const counts = await pool.query(
    `SELECT (SELECT count(*) FROM resources) AS resources, (SELECT count(*) FROM resource_relations) AS relations,
            (SELECT count(*) FROM deployments) AS deployments, (SELECT count(*) FROM software_lifecycle_events) AS events`,
  );
  console.log('seeded:', counts.rows[0]);
} finally {
  await pool.end();
}
