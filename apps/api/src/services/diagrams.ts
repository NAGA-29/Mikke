import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Actor } from '../auth.js';
import { recordAudit } from '../audit.js';
import { many, one, type Queryable } from '../db/pool.js';
import { notFound } from '../errors.js';
import { insertRow, updateColumns } from '../lib/sql.js';
import { attributes, optStr, parse, reqStr, uuid } from '../lib/validation.js';
import { requireResource } from './common.js';

const viewport = z.union([
  z.strictObject({}),
  z.strictObject({ x: z.number(), y: z.number(), zoom: z.number().positive() }),
]);
const diagramSchema = z.strictObject({ name: reqStr(255), description: optStr(10_000), viewport: viewport.optional() });
const placementSchema = z.strictObject({
  position_x: z.number(), position_y: z.number(), display_options: attributes.optional(),
});
const edgeKind = z.enum(['relation', 'deployment', 'hosting', 'app_repository']);
const edgeSchema = z.strictObject({ edge_kind: edgeKind, edge_record_id: uuid });
type Edge = z.infer<typeof edgeSchema>;

export async function getDiagram(db: Queryable, id: string, lock = false) {
  const row = await one(db, `SELECT * FROM diagrams WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!row) throw notFound('diagram', id);
  return row;
}

export async function listDiagrams(db: Queryable, query: unknown) {
  const f = parse(z.strictObject({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }), query);
  return many(db, 'SELECT * FROM diagrams ORDER BY created_at, id LIMIT $1 OFFSET $2', [f.limit, f.offset]);
}

export async function createDiagram(tx: PoolClient, actor: Actor, body: unknown) {
  const row = await insertRow<{ id: string }>(tx, 'diagrams', parse(diagramSchema, body));
  await recordAudit(tx, { actorId: actor.id, action: 'create', entityType: 'diagram', entityId: row.id, after: row });
  return row;
}

export async function updateDiagram(tx: PoolClient, actor: Actor, id: string, body: unknown) {
  const input = parse(diagramSchema.partial(), body);
  const before = await getDiagram(tx, id, true);
  const after = await updateColumns(tx, 'diagrams', 'id', id, input, Object.keys(diagramSchema.shape));
  await recordAudit(tx, { actorId: actor.id, action: 'update', entityType: 'diagram', entityId: id, before, after });
  return after;
}

export async function deleteDiagram(tx: PoolClient, actor: Actor, id: string) {
  const before = await getDiagram(tx, id, true);
  // カスケード削除される表示設定も監査に残す。資産・関係正本は変更しない。
  const nodes = await many(tx, 'SELECT * FROM diagram_nodes WHERE diagram_id = $1 ORDER BY id', [id]);
  const hidden_edges = await many(tx, 'SELECT * FROM diagram_hidden_edges WHERE diagram_id = $1 ORDER BY edge_kind, edge_record_id', [id]);
  await tx.query('DELETE FROM diagrams WHERE id = $1', [id]);
  await recordAudit(tx, { actorId: actor.id, action: 'delete', entityType: 'diagram', entityId: id, before: { ...before, nodes, hidden_edges } });
}

export async function listNodes(db: Queryable, id: string) {
  await getDiagram(db, id);
  return many(db, 'SELECT * FROM diagram_nodes WHERE diagram_id = $1 ORDER BY id', [id]);
}

export async function getNode(db: Queryable, diagramId: string, nodeId: string, lock = false) {
  const row = await one(db, `SELECT * FROM diagram_nodes WHERE diagram_id = $1 AND id = $2${lock ? ' FOR UPDATE' : ''}`, [diagramId, nodeId]);
  if (!row) throw notFound('diagram node', nodeId);
  return row;
}

export async function createNode(tx: PoolClient, actor: Actor, id: string, body: unknown) {
  const input = parse(placementSchema.extend({ resource_id: uuid }), body);
  await requireResource(tx, input.resource_id);
  await getDiagram(tx, id, true);
  const row = await insertRow<{ id: string }>(tx, 'diagram_nodes', { diagram_id: id, ...input });
  await recordAudit(tx, { actorId: actor.id, action: 'create', entityType: 'diagram_node', entityId: row.id, after: row });
  return row;
}

export async function updateNode(tx: PoolClient, actor: Actor, id: string, nodeId: string, body: unknown) {
  const input = parse(placementSchema.partial(), body);
  await getDiagram(tx, id, true);
  const before = await getNode(tx, id, nodeId, true);
  const after = await updateColumns(tx, 'diagram_nodes', 'id', nodeId, input, Object.keys(placementSchema.shape));
  await recordAudit(tx, { actorId: actor.id, action: 'update', entityType: 'diagram_node', entityId: nodeId, before, after });
  return after;
}

export async function deleteNode(tx: PoolClient, actor: Actor, id: string, nodeId: string) {
  await getDiagram(tx, id, true);
  const before = await getNode(tx, id, nodeId, true);
  await tx.query('DELETE FROM diagram_nodes WHERE id = $1', [nodeId]);
  await recordAudit(tx, { actorId: actor.id, action: 'delete', entityType: 'diagram_node', entityId: nodeId, before });
}

/** 正本の削除・ホスト変更と直列化する。必ず図のロックより先に呼ぶ。 */
async function lockEdge(tx: PoolClient, edge: Edge) {
  const id = edge.edge_record_id;
  if (edge.edge_kind === 'hosting') {
    await requireResource(tx, id, { types: ['service_instance'], allowArchived: true, lock: true });
    const row = await one(tx, 'SELECT 1 FROM service_instances WHERE resource_id = $1 AND host_compute_id IS NOT NULL', [id]);
    if (!row) throw notFound('hosting edge', id);
    return;
  }
  if (edge.edge_kind === 'app_repository') {
    const link = await one<{ application_id: string }>(tx, 'SELECT application_id FROM application_repositories WHERE id = $1', [id]);
    if (!link) throw notFound('app_repository edge', id);
    // リンク削除側と同じくアプリ行 → リンク行の順。
    await tx.query('SELECT 1 FROM resources WHERE id = $1 FOR SHARE', [link.application_id]);
  }
  const table = { relation: 'resource_relations', deployment: 'deployments', app_repository: 'application_repositories' }[edge.edge_kind];
  if (!await one(tx, `SELECT 1 FROM ${table} WHERE id = $1 FOR SHARE`, [id])) throw notFound(`${edge.edge_kind} edge`, id);
}

export async function listHiddenEdges(db: Queryable, id: string) {
  await getDiagram(db, id);
  return many(db, 'SELECT * FROM diagram_hidden_edges WHERE diagram_id = $1 ORDER BY edge_kind, edge_record_id', [id]);
}

export async function hideEdge(tx: PoolClient, actor: Actor, id: string, body: unknown) {
  const edge = parse(edgeSchema, body);
  await lockEdge(tx, edge);
  await getDiagram(tx, id, true);
  const row = await one(tx, `INSERT INTO diagram_hidden_edges (diagram_id, edge_kind, edge_record_id)
    VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`, [id, edge.edge_kind, edge.edge_record_id]);
  if (row) await recordAudit(tx, { actorId: actor.id, action: 'create', entityType: 'diagram_hidden_edge', entityId: id, after: row });
  return row ?? await one(tx, 'SELECT * FROM diagram_hidden_edges WHERE diagram_id = $1 AND edge_kind = $2 AND edge_record_id = $3', [id, edge.edge_kind, edge.edge_record_id]);
}

export async function unhideEdge(tx: PoolClient, actor: Actor, id: string, kind: string, recordId: string) {
  const edge = parse(edgeSchema, { edge_kind: kind, edge_record_id: recordId });
  await getDiagram(tx, id, true);
  const before = await one(tx, `DELETE FROM diagram_hidden_edges WHERE diagram_id = $1 AND edge_kind = $2 AND edge_record_id = $3 RETURNING *`, [id, edge.edge_kind, edge.edge_record_id]);
  if (before) await recordAudit(tx, { actorId: actor.id, action: 'delete', entityType: 'diagram_hidden_edge', entityId: id, before });
}

/** 正本由来の共通エッジ。inactive deployment も履歴として含め、status を明示する。 */
export const GRAPH_EDGES_SQL = `
  SELECT 'relation'::text AS edge_kind, id AS edge_record_id, source_resource_id, target_resource_id,
         relation_type AS label, jsonb_build_object('description', description) AS details FROM resource_relations
  UNION ALL
  SELECT 'deployment', id, application_id, target_resource_id, 'deployed_on',
         jsonb_build_object('environment', environment, 'status', status, 'revision', revision) FROM deployments
  UNION ALL
  SELECT 'hosting', resource_id, resource_id, host_compute_id, 'hosted_on', '{}'::jsonb
    FROM service_instances WHERE host_compute_id IS NOT NULL
  UNION ALL
  SELECT 'app_repository', id, application_id, repository_id, 'sourced_from',
         jsonb_build_object('purpose', purpose) FROM application_repositories
`;

export async function getGraph(db: Queryable, query: unknown) {
  const { diagram_id: id } = parse(z.strictObject({ diagram_id: uuid }), query);
  // 1文で取得し、ノード・エッジ・図の存在を同一スナップショットで評価する。
  const result = await one(db, `WITH nodes AS (
    SELECT n.*, r.name, r.resource_type, r.lifecycle_status, r.archived_at,
           (r.archived_at IS NOT NULL) AS archived
      FROM diagram_nodes n JOIN resources r ON r.id = n.resource_id WHERE n.diagram_id = $1
  ), edges AS (${GRAPH_EDGES_SQL})
  SELECT to_jsonb(d) AS diagram,
    (SELECT coalesce(jsonb_agg(n ORDER BY n.id), '[]'::jsonb) FROM nodes n) AS nodes,
    (SELECT coalesce(jsonb_agg(e ORDER BY e.edge_kind, e.edge_record_id), '[]'::jsonb) FROM edges e
      WHERE EXISTS (SELECT 1 FROM nodes WHERE resource_id = e.source_resource_id)
        AND EXISTS (SELECT 1 FROM nodes WHERE resource_id = e.target_resource_id)
        AND NOT EXISTS (SELECT 1 FROM diagram_hidden_edges h WHERE h.diagram_id = $1
          AND h.edge_kind = e.edge_kind AND h.edge_record_id = e.edge_record_id)) AS edges
    FROM diagrams d WHERE d.id = $1`, [id]);
  if (!result) throw notFound('diagram', id);
  return result;
}
