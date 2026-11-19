import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Actor } from '../auth.js';
import { recordAudit } from '../audit.js';
import type { Queryable } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { conflict, invalid, notFound } from '../errors.js';
import { insertRow, updateColumns } from '../lib/sql.js';
import {
  attributes,
  endpoint,
  environment,
  ipAddress,
  optStr,
  optTimestamp,
  parse,
  reqStr,
  uuid,
} from '../lib/validation.js';
import { cleanupHiddenEdges, requireResource, RESOURCE_TYPES, type ResourceRow, type ResourceType } from './common.js';

// ---------------------------------------------------------------------------
// 入力スキーマ
// ---------------------------------------------------------------------------

const baseFields = {
  name: reqStr(255),
  description: z.string().max(10_000).nullable().optional(),
  environment: environment.nullable().optional(),
  lifecycle_status: z.enum(['active', 'maintenance', 'retired']).optional(),
  last_verified_at: optTimestamp,
};

const computeDetail = z.strictObject({
  asset_kind: z.enum(['vps', 'vm', 'ec2', 'baremetal', 'container_host']),
  hostname: optStr(255),
  display_alias: optStr(255),
  provider: optStr(100),
  region: optStr(100),
  os_name: optStr(100),
  os_version: optStr(100),
  os_software_product_id: uuid.nullable().optional(),
  architecture: optStr(32),
  public_ip: ipAddress.nullable().optional(),
  private_ip: ipAddress.nullable().optional(),
  attributes: attributes.optional(),
});

const applicationDetail = z.strictObject({
  framework: optStr(100),
  framework_version: optStr(100),
  runtime: optStr(100),
  runtime_requirement: optStr(100),
  build_tool: optStr(100),
  attributes: attributes.optional(),
});

const serviceInstanceDetail = z.strictObject({
  service_kind: z.enum(['database', 'cache', 'queue', 'storage', 'hosting', 'other']),
  engine: optStr(100),
  engine_version: optStr(100),
  software_product_id: uuid.nullable().optional(),
  provider: optStr(100),
  is_managed: z.boolean().optional(),
  host_compute_id: uuid.nullable().optional(),
  endpoint: endpoint.nullable().optional(),
  attributes: attributes.optional(),
});

const repositoryDetail = z.strictObject({
  provider: optStr(50),
  repository_url: reqStr(2048),
  default_branch: optStr(255),
});

// release_cycle_id / os_release_cycle_id は assign_release_cycle 経由でのみ変更する
const DETAILS = {
  compute: { table: 'compute_assets', create: computeDetail, patch: computeDetail.partial() },
  application: { table: 'applications', create: applicationDetail, patch: applicationDetail.partial() },
  service_instance: { table: 'service_instances', create: serviceInstanceDetail, patch: serviceInstanceDetail.partial() },
  repository: { table: 'repositories', create: repositoryDetail, patch: repositoryDetail.partial() },
} as const satisfies Record<ResourceType, unknown>;

export const createResourceSchema = z.discriminatedUnion('resource_type', [
  z.strictObject({ resource_type: z.literal('compute'), ...baseFields, detail: computeDetail }),
  z.strictObject({ resource_type: z.literal('application'), ...baseFields, detail: applicationDetail.default({}) }),
  z.strictObject({ resource_type: z.literal('service_instance'), ...baseFields, detail: serviceInstanceDetail }),
  z.strictObject({ resource_type: z.literal('repository'), ...baseFields, detail: repositoryDetail }),
]);
export type CreateResourceInput = z.infer<typeof createResourceSchema>;

export const updateResourceSchema = z.strictObject({
  name: baseFields.name.optional(),
  description: baseFields.description,
  environment: baseFields.environment,
  lifecycle_status: baseFields.lifecycle_status,
  last_verified_at: baseFields.last_verified_at,
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;

export const listResourcesSchema = z.object({
  type: z.enum(RESOURCE_TYPES).optional(),
  q: z.string().trim().max(255).optional(),
  environment: z.string().max(32).optional(),
  lifecycle_status: z.enum(['active', 'maintenance', 'retired']).optional(),
  include_archived: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// 補助
// ---------------------------------------------------------------------------

/**
 * リポジトリURLの正規化: scp形式・ssh/git/http を https://host/owner/repo に揃え、.git と末尾 / を除去。
 * 認証情報入りURLは拒否する。
 */
export function normalizeRepositoryUrl(raw: string): string {
  let s = raw.trim();
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+)$/.exec(s);
  if (scp && !s.includes('://')) s = `ssh://${scp[1]}/${scp[2]}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw invalid('invalid_repository_url', `repository_url is not a valid URL: ${raw}`);
  }
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(u.protocol)) {
    throw invalid('invalid_repository_url', 'repository_url must be https/ssh/git URL');
  }
  if (u.password || (u.username && u.protocol.startsWith('http'))) {
    throw invalid('invalid_repository_url', 'repository_url must not contain credentials');
  }
  const path = u.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!path || path === '/') throw invalid('invalid_repository_url', 'repository_url must include a repository path');
  // http(s) の明示ポートは別サーバーを指しうるので保持する（ssh/git のポートは HTTPS とは無関係なので捨てる）
  const port = u.protocol === 'https:' || u.protocol === 'http:' ? u.port : '';
  return `https://${u.hostname.toLowerCase()}${port ? `:${port}` : ''}${path}`;
}

const SELECT_WITH_DETAIL = `
  SELECT r.*,
         (COALESCE(to_jsonb(c), to_jsonb(a), to_jsonb(s), to_jsonb(rp)) - 'resource_id' - 'resource_type') AS detail
    FROM resources r
    LEFT JOIN compute_assets c ON c.resource_id = r.id
    LEFT JOIN applications a ON a.resource_id = r.id
    LEFT JOIN service_instances s ON s.resource_id = r.id
    LEFT JOIN repositories rp ON rp.resource_id = r.id`;

export type ResourceWithDetail = ResourceRow & { detail: Record<string, unknown> | null };

async function validateDetailRefs(
  db: Queryable,
  type: ResourceType,
  detail: Record<string, unknown>,
  current?: Record<string, unknown> | null,
): Promise<void> {
  if (type === 'service_instance') {
    if (typeof detail.host_compute_id === 'string') {
      await requireResource(db, detail.host_compute_id, { types: ['compute'], label: 'host compute' });
    }
    if (
      current &&
      detail.software_product_id !== undefined &&
      detail.software_product_id !== current.software_product_id &&
      current.release_cycle_id
    ) {
      throw conflict(
        'release_cycle_assigned',
        'software_product_id cannot change while a release cycle is assigned; unassign the release cycle first',
      );
    }
  }
  if (type === 'compute' && current) {
    if (
      detail.os_software_product_id !== undefined &&
      detail.os_software_product_id !== current.os_software_product_id &&
      current.os_release_cycle_id
    ) {
      throw conflict(
        'release_cycle_assigned',
        'os_software_product_id cannot change while an OS release cycle is assigned; unassign it first',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

export async function getResource(db: Queryable, id: string): Promise<ResourceWithDetail> {
  const row = await one<ResourceWithDetail>(db, `${SELECT_WITH_DETAIL} WHERE r.id = $1`, [id]);
  if (!row) throw notFound('resource', id);
  return row;
}

export async function listResources(db: Queryable, query: unknown) {
  const f = parse(listResourcesSchema, query);
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, v: unknown) => {
    params.push(v);
    where.push(cond.replace('?', `$${params.length}`));
  };
  if (f.type) add('r.resource_type = ?', f.type);
  if (f.q) add(`r.name ILIKE ?`, `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  if (f.environment) add('r.environment = ?', f.environment);
  if (f.lifecycle_status) add('r.lifecycle_status = ?', f.lifecycle_status);
  if (f.include_archived !== 'true') where.push('r.archived_at IS NULL');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const items = await many<ResourceWithDetail>(
    db,
    `${SELECT_WITH_DETAIL} ${whereSql} ORDER BY r.name, r.id LIMIT ${f.limit} OFFSET ${f.offset}`,
    params,
  );
  return { items, limit: f.limit, offset: f.offset };
}

export async function createResource(tx: PoolClient, actor: Actor, body: unknown): Promise<ResourceWithDetail> {
  const input = parse(createResourceSchema, body);
  const { resource_type, detail, ...base } = input;
  const detailRow: Record<string, unknown> = { ...detail };
  if (resource_type === 'repository') detailRow.repository_url = normalizeRepositoryUrl(detail.repository_url);
  await validateDetailRefs(tx, resource_type, detailRow);

  const resource = await insertRow<ResourceRow>(tx, 'resources', { resource_type, ...base });
  await insertRow(tx, DETAILS[resource_type].table, { resource_id: resource.id, ...detailRow });
  const created = await getResource(tx, resource.id);
  await recordAudit(tx, { actorId: actor.id, action: 'create', entityType: 'resource', entityId: resource.id, after: created });
  return created;
}

export async function updateResource(tx: PoolClient, actor: Actor, id: string, body: unknown): Promise<ResourceWithDetail> {
  const input = parse(updateResourceSchema, body);
  const resource = await requireResource(tx, id, { lock: true });
  const before = await getResource(tx, id);
  const def = DETAILS[resource.resource_type];
  const detail: Record<string, unknown> = input.detail ? parse(def.patch, input.detail) : {};
  if (resource.resource_type === 'repository' && typeof detail.repository_url === 'string') {
    detail.repository_url = normalizeRepositoryUrl(detail.repository_url);
  }
  await validateDetailRefs(tx, resource.resource_type, detail, before.detail);
  if (
    resource.resource_type === 'service_instance' &&
    before.detail?.service_kind === 'hosting' &&
    detail.service_kind !== undefined &&
    detail.service_kind !== 'hosting'
  ) {
    // 行は FOR UPDATE 済みで、deployment 作成側は配置先に FOR SHARE を取るため並行作成とも直列化される
    const used = await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM deployments WHERE target_resource_id = $1', [id]);
    if (used?.n) {
      throw conflict('hosting_in_use', 'service_kind cannot change from hosting while deployments target this service', {
        deployments: used.n,
      });
    }
  }

  const { detail: _ignored, ...base } = input;
  await updateColumns(tx, 'resources', 'id', id, base, [
    'name',
    'description',
    'environment',
    'lifecycle_status',
    'last_verified_at',
  ]);
  const detailCols = Object.keys(def.patch.shape);
  await updateColumns(tx, def.table, 'resource_id', id, detail, detailCols);
  // 詳細だけの更新でも共通行の updated_at を進める
  await tx.query('UPDATE resources SET updated_at = now() WHERE id = $1', [id]);

  if (
    resource.resource_type === 'service_instance' &&
    detail.host_compute_id !== undefined &&
    detail.host_compute_id !== before.detail?.host_compute_id
  ) {
    await cleanupHiddenEdges(tx, 'hosting', id);
  }

  const after = await getResource(tx, id);
  await recordAudit(tx, { actorId: actor.id, action: 'update', entityType: 'resource', entityId: id, before, after });
  return after;
}

/** アーカイブ前確認用: このResourceを参照している関係を列挙する（設計 §7） */
export async function getReferences(db: Queryable, id: string) {
  await requireResource(db, id, { allowArchived: true });
  // トランザクション内の同一クライアントでも使うため逐次実行する
  const q = (sql: string) => many(db, sql, [id]);
  const deploymentsAsApplication = await q('SELECT * FROM deployments WHERE application_id = $1 ORDER BY created_at');
  const deploymentsAsTarget = await q('SELECT * FROM deployments WHERE target_resource_id = $1 ORDER BY created_at');
  const deploymentsAsRepository = await q('SELECT * FROM deployments WHERE repository_id = $1 ORDER BY created_at');
  const hostedServices = await q(
    `SELECT r.id, r.name, r.archived_at FROM service_instances s JOIN resources r ON r.id = s.resource_id
      WHERE s.host_compute_id = $1 ORDER BY r.name`,
  );
  const host = await q(
    `SELECT r.id, r.name, r.archived_at FROM service_instances s JOIN resources r ON r.id = s.host_compute_id
      WHERE s.resource_id = $1`,
  );
  const relationsOut = await q('SELECT * FROM resource_relations WHERE source_resource_id = $1 ORDER BY created_at');
  const relationsIn = await q('SELECT * FROM resource_relations WHERE target_resource_id = $1 ORDER BY created_at');
  const appRepos = await q('SELECT * FROM application_repositories WHERE application_id = $1 OR repository_id = $1 ORDER BY created_at');
  const installations = await q('SELECT * FROM software_installations WHERE compute_asset_id = $1 ORDER BY created_at');
  const diagramNodes = await q('SELECT diagram_id FROM diagram_nodes WHERE resource_id = $1');
  return {
    deployments_as_application: deploymentsAsApplication,
    deployments_as_target: deploymentsAsTarget,
    deployments_as_repository: deploymentsAsRepository,
    hosted_services: hostedServices,
    host: host[0] ?? null,
    relations_out: relationsOut,
    relations_in: relationsIn,
    application_repositories: appRepos,
    software_installations: installations,
    diagram_ids: diagramNodes.map((n) => n.diagram_id as string),
  };
}

/** 論理アーカイブ。関連レコードは削除しない（設計 §7） */
export async function archiveResource(tx: PoolClient, actor: Actor, id: string) {
  const row = await requireResource(tx, id, { lock: true, allowArchived: true });
  if (row.archived_at) throw conflict('already_archived', `resource ${id} is already archived`);
  const references = await getReferences(tx, id);
  const before = await getResource(tx, id);
  await tx.query('UPDATE resources SET archived_at = now() WHERE id = $1', [id]);
  const after = await getResource(tx, id);
  await recordAudit(tx, { actorId: actor.id, action: 'archive', entityType: 'resource', entityId: id, before, after });
  return { resource: after, references };
}

export async function restoreResource(tx: PoolClient, actor: Actor, id: string) {
  const row = await requireResource(tx, id, { lock: true, allowArchived: true });
  if (!row.archived_at) throw conflict('not_archived', `resource ${id} is not archived`);
  const before = await getResource(tx, id);
  await tx.query('UPDATE resources SET archived_at = NULL WHERE id = $1', [id]);
  const after = await getResource(tx, id);
  await recordAudit(tx, { actorId: actor.id, action: 'restore', entityType: 'resource', entityId: id, before, after });
  return after;
}
