import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Actor } from '../auth.js';
import { recordAudit } from '../audit.js';
import type { Queryable } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { conflict, invalid, notFound } from '../errors.js';
import { insertRow } from '../lib/sql.js';
import { parse, uuid } from '../lib/validation.js';
import { cleanupHiddenEdges, requireResource } from './common.js';

// ---------------------------------------------------------------------------
// relation_types / resource_relations
// ---------------------------------------------------------------------------

export async function listRelationTypes(db: Queryable) {
  return many(db, 'SELECT * FROM relation_types ORDER BY code');
}

const createRelationSchema = z.strictObject({
  source_resource_id: uuid,
  target_resource_id: uuid,
  relation_type: z.string().min(1).max(50),
  description: z.string().max(10_000).nullable().optional(),
});

export async function createRelation(tx: PoolClient, actor: Actor, body: unknown) {
  const input = parse(createRelationSchema, body);
  if (input.source_resource_id === input.target_resource_id) {
    throw invalid('self_relation', 'source and target must be different resources');
  }
  const type = await one<{ code: string; is_active: boolean }>(tx, 'SELECT * FROM relation_types WHERE code = $1', [
    input.relation_type,
  ]);
  if (!type || !type.is_active) {
    throw invalid('unknown_relation_type', `relation_type ${input.relation_type} is not an active relation type`);
  }
  await requireResource(tx, input.source_resource_id, { label: 'source resource' });
  await requireResource(tx, input.target_resource_id, { label: 'target resource' });
  const row = await insertRow<{ id: string }>(tx, 'resource_relations', input);
  await recordAudit(tx, { actorId: actor.id, action: 'create', entityType: 'resource_relation', entityId: row.id, after: row });
  return row;
}

export async function getRelation(db: Queryable, id: string) {
  const row = await one(db, 'SELECT * FROM resource_relations WHERE id = $1', [id]);
  if (!row) throw notFound('relation', id);
  return row;
}

const listRelationsSchema = z.object({
  resource_id: uuid.optional(),
  direction: z.enum(['out', 'in', 'both']).default('both'),
  relation_type: z.string().max(50).optional(),
});

/** アーカイブ済みの端点を持つ関係には *_archived フラグを付ける（設計 §1-3「要確認」） */
export async function listRelations(db: Queryable, query: unknown) {
  const f = parse(listRelationsSchema, query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.resource_id) {
    params.push(f.resource_id);
    const p = `$${params.length}`;
    where.push(
      f.direction === 'out'
        ? `rr.source_resource_id = ${p}`
        : f.direction === 'in'
          ? `rr.target_resource_id = ${p}`
          : `(rr.source_resource_id = ${p} OR rr.target_resource_id = ${p})`,
    );
  }
  if (f.relation_type) {
    params.push(f.relation_type);
    where.push(`rr.relation_type = $${params.length}`);
  }
  return many(
    db,
    `SELECT rr.*,
            s.name AS source_name, s.resource_type AS source_type, (s.archived_at IS NOT NULL) AS source_archived,
            t.name AS target_name, t.resource_type AS target_type, (t.archived_at IS NOT NULL) AS target_archived
       FROM resource_relations rr
       JOIN resources s ON s.id = rr.source_resource_id
       JOIN resources t ON t.id = rr.target_resource_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY rr.created_at, rr.id`,
    params,
  );
}

/** 正本の関係を削除（全図・MCPに反映）。図の非表示指定も掃除する */
export async function deleteRelation(tx: PoolClient, actor: Actor, id: string) {
  const before = await one<{ id: string }>(tx, 'SELECT * FROM resource_relations WHERE id = $1 FOR UPDATE', [id]);
  if (!before) throw notFound('relation', id);
  await tx.query('DELETE FROM resource_relations WHERE id = $1', [id]);
  await cleanupHiddenEdges(tx, 'relation', id);
  await recordAudit(tx, { actorId: actor.id, action: 'delete', entityType: 'resource_relation', entityId: id, before });
}

// ---------------------------------------------------------------------------
// application_repositories
// ---------------------------------------------------------------------------

const createAppRepoSchema = z.strictObject({
  application_id: uuid,
  repository_id: uuid,
  purpose: z.enum(['source', 'config', 'infra', 'other']).default('source'),
});

export async function createApplicationRepository(tx: PoolClient, actor: Actor, body: unknown) {
  const input = parse(createAppRepoSchema, body);
  await requireResource(tx, input.application_id, { types: ['application'], label: 'application' });
  await requireResource(tx, input.repository_id, { types: ['repository'], label: 'repository' });
  const row = await insertRow<{ id: string }>(tx, 'application_repositories', input);
  await recordAudit(tx, { actorId: actor.id, action: 'create', entityType: 'application_repository', entityId: row.id, after: row });
  return row;
}

export async function listApplicationRepositories(db: Queryable, query: unknown) {
  const f = parse(z.object({ application_id: uuid.optional(), repository_id: uuid.optional() }), query);
  return many(
    db,
    `SELECT ar.*, a.name AS application_name, r.name AS repository_name, rp.repository_url
       FROM application_repositories ar
       JOIN resources a ON a.id = ar.application_id
       JOIN resources r ON r.id = ar.repository_id
       JOIN repositories rp ON rp.resource_id = ar.repository_id
      WHERE ($1::uuid IS NULL OR ar.application_id = $1) AND ($2::uuid IS NULL OR ar.repository_id = $2)
      ORDER BY ar.created_at, ar.id`,
    [f.application_id ?? null, f.repository_id ?? null],
  );
}

export async function deleteApplicationRepository(tx: PoolClient, actor: Actor, id: string) {
  const before = await one<{ id: string; application_id: string; repository_id: string }>(
    tx,
    'SELECT * FROM application_repositories WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (!before) throw notFound('application repository link', id);
  const others = await one<{ n: number }>(
    tx,
    `SELECT count(*)::int AS n FROM application_repositories
      WHERE application_id = $1 AND repository_id = $2 AND id <> $3`,
    [before.application_id, before.repository_id, id],
  );
  if (!others?.n) {
    const used = await one<{ n: number }>(
      tx,
      'SELECT count(*)::int AS n FROM deployments WHERE application_id = $1 AND repository_id = $2',
      [before.application_id, before.repository_id],
    );
    if (used?.n) {
      throw conflict('link_in_use', 'deployments reference this application/repository pair; update them first', {
        deployments: used.n,
      });
    }
  }
  await tx.query('DELETE FROM application_repositories WHERE id = $1', [id]);
  await cleanupHiddenEdges(tx, 'app_repository', id);
  await recordAudit(tx, { actorId: actor.id, action: 'delete', entityType: 'application_repository', entityId: id, before });
}
