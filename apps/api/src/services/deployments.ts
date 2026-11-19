import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Actor } from '../auth.js';
import { recordAudit } from '../audit.js';
import type { Queryable } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { invalid, notFound } from '../errors.js';
import { insertRow, updateColumns } from '../lib/sql.js';
import { environment, optStr, optTimestamp, parse, uuid } from '../lib/validation.js';
import { requireResource } from './common.js';

const fields = {
  target_resource_id: uuid,
  repository_id: uuid.nullable().optional(),
  environment,
  deploy_path: z.string().max(2048).nullable().optional(),
  deploy_method: optStr(100),
  revision: optStr(255),
  status: z.enum(['active', 'inactive']).optional(),
  deployed_at: optTimestamp,
};

const createSchema = z.strictObject({ application_id: uuid, ...fields });
const patchSchema = z.strictObject(fields).partial();

interface DeploymentRow {
  id: string;
  application_id: string;
  target_resource_id: string;
  repository_id: string | null;
}

/** 配置先は compute、または service_kind = hosting の service_instance のみ（設計 §4.7） */
async function validateTarget(db: Queryable, targetId: string) {
  const target = await requireResource(db, targetId, {
    types: ['compute', 'service_instance'],
    label: 'deployment target',
  });
  if (target.resource_type === 'service_instance') {
    const s = await one<{ service_kind: string }>(db, 'SELECT service_kind FROM service_instances WHERE resource_id = $1', [targetId]);
    if (s?.service_kind !== 'hosting') {
      throw invalid('invalid_deployment_target', 'service instance targets must have service_kind = hosting');
    }
  }
}

/** repository_id を指定する場合、アプリとの application_repositories が必須（MVPで強制） */
async function validateRepository(db: Queryable, applicationId: string, repositoryId: string) {
  await requireResource(db, repositoryId, { types: ['repository'], label: 'repository' });
  const link = await one(db, 'SELECT 1 FROM application_repositories WHERE application_id = $1 AND repository_id = $2', [
    applicationId,
    repositoryId,
  ]);
  if (!link) {
    throw invalid('repository_not_linked', 'repository is not linked to the application (application_repositories)');
  }
}

export async function createDeployment(tx: PoolClient, actor: Actor, body: unknown) {
  const input = parse(createSchema, body);
  await requireResource(tx, input.application_id, { types: ['application'], label: 'application' });
  await validateTarget(tx, input.target_resource_id);
  if (input.repository_id) await validateRepository(tx, input.application_id, input.repository_id);
  const row = await insertRow<DeploymentRow>(tx, 'deployments', input);
  await recordAudit(tx, { actorId: actor.id, action: 'create', entityType: 'deployment', entityId: row.id, after: row });
  return row;
}

export async function updateDeployment(tx: PoolClient, actor: Actor, id: string, body: unknown) {
  const input = parse(patchSchema, body);
  const before = await one<DeploymentRow>(tx, 'SELECT * FROM deployments WHERE id = $1 FOR UPDATE', [id]);
  if (!before) throw notFound('deployment', id);
  // 既存配置の status 変更（inactive化など）はアーカイブ済み端点でも許可。新しい参照先だけ検証する
  if (input.target_resource_id && input.target_resource_id !== before.target_resource_id) {
    await validateTarget(tx, input.target_resource_id);
  }
  if (input.repository_id && input.repository_id !== before.repository_id) {
    // リンク削除と直列化するためアプリ行に共有ロックを取る（deleteApplicationRepository は FOR UPDATE）
    await requireResource(tx, before.application_id, { types: ['application'], label: 'application' });
    await validateRepository(tx, before.application_id, input.repository_id);
  }
  const after = await updateColumns<DeploymentRow>(tx, 'deployments', 'id', id, input, Object.keys(fields));
  await recordAudit(tx, { actorId: actor.id, action: 'update', entityType: 'deployment', entityId: id, before, after });
  return after;
}

export async function getDeployment(db: Queryable, id: string) {
  const row = await one(db, 'SELECT * FROM deployments WHERE id = $1', [id]);
  if (!row) throw notFound('deployment', id);
  return row;
}

const listSchema = z.object({
  application_id: uuid.optional(),
  target_resource_id: uuid.optional(),
  environment: z.string().max(32).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export async function listDeployments(db: Queryable, query: unknown) {
  const f = parse(listSchema, query);
  return many(
    db,
    `SELECT d.*, a.name AS application_name, t.name AS target_name, t.resource_type AS target_type,
            (t.archived_at IS NOT NULL) AS target_archived, (a.archived_at IS NOT NULL) AS application_archived
       FROM deployments d
       JOIN resources a ON a.id = d.application_id
       JOIN resources t ON t.id = d.target_resource_id
      WHERE ($1::uuid IS NULL OR d.application_id = $1)
        AND ($2::uuid IS NULL OR d.target_resource_id = $2)
        AND ($3::text IS NULL OR d.environment = $3)
        AND ($4::text IS NULL OR d.status = $4)
      ORDER BY d.environment, d.created_at, d.id`,
    [f.application_id ?? null, f.target_resource_id ?? null, f.environment ?? null, f.status ?? null],
  );
}
