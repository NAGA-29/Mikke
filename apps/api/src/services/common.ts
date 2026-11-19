import type { Queryable } from '../db/pool.js';
import { one } from '../db/pool.js';
import { conflict, invalid, notFound } from '../errors.js';

export const RESOURCE_TYPES = ['compute', 'application', 'service_instance', 'repository'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface ResourceRow {
  id: string;
  resource_type: ResourceType;
  name: string;
  description: string | null;
  environment: string | null;
  lifecycle_status: 'active' | 'maintenance' | 'retired';
  last_verified_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Resource を取得し、存在・種別・アーカイブ状態を検証する。
 * 新しい関係（配置・依存・導入など）をアーカイブ済みResourceへ張ることは禁止（復元してから行う）。
 *
 * ロック: lock=true は FOR UPDATE。アーカイブ済みを拒否する通常の検証では FOR SHARE を取り、
 * 検証後・コミット前に別トランザクションがアーカイブ（FOR UPDATE）できないようにする。
 * 共有ロック同士は競合しないので、関係作成どうしでデッドロックは起きない。
 */
export async function requireResource(
  db: Queryable,
  id: string,
  opts: { types?: readonly ResourceType[]; allowArchived?: boolean; lock?: boolean; label?: string } = {},
): Promise<ResourceRow> {
  const lockClause = opts.lock ? ' FOR UPDATE' : opts.allowArchived ? '' : ' FOR SHARE';
  const row = await one<ResourceRow>(db, `SELECT * FROM resources WHERE id = $1${lockClause}`, [id]);
  const label = opts.label ?? 'resource';
  if (!row) throw notFound(label, id);
  if (opts.types && !opts.types.includes(row.resource_type)) {
    throw invalid('invalid_resource_type', `${label} ${id} must be one of: ${opts.types.join(', ')}`, {
      actual: row.resource_type,
    });
  }
  if (!opts.allowArchived && row.archived_at) {
    throw conflict('resource_archived', `${label} ${id} is archived; restore it first`);
  }
  return row;
}

/** EOL管理上「稼働中の管理対象」とみなす条件（設計 §12.0: アーカイブ済み・retired は除外） */
export const IN_SERVICE = `r.archived_at IS NULL AND r.lifecycle_status <> 'retired'`;

/**
 * EOL判定対象の共通表現。
 * target_kind: installation（software_installations.id）/ service_instance / compute_os（いずれも resources.id）
 */
export const EOL_TARGETS_SQL = `
  SELECT 'installation'::text AS target_kind, si.id AS target_id, si.compute_asset_id AS resource_id,
         si.software_product_id, si.release_cycle_id, si.version
    FROM software_installations si JOIN resources r ON r.id = si.compute_asset_id
   WHERE ${IN_SERVICE}
  UNION ALL
  SELECT 'service_instance', s.resource_id, s.resource_id,
         s.software_product_id, s.release_cycle_id, s.engine_version
    FROM service_instances s JOIN resources r ON r.id = s.resource_id
   WHERE ${IN_SERVICE} AND (s.software_product_id IS NOT NULL OR s.engine IS NOT NULL OR s.engine_version IS NOT NULL)
  UNION ALL
  SELECT 'compute_os', c.resource_id, c.resource_id,
         c.os_software_product_id, c.os_release_cycle_id, c.os_version
    FROM compute_assets c JOIN resources r ON r.id = c.resource_id
   WHERE ${IN_SERVICE} AND (c.os_software_product_id IS NOT NULL OR c.os_name IS NOT NULL)
`;

export interface EolTargetRow {
  target_kind: 'installation' | 'service_instance' | 'compute_os';
  target_id: string;
  resource_id: string;
  software_product_id: string | null;
  release_cycle_id: string | null;
  version: string | null;
}

/** diagram_hidden_edges は異種参照のためFKが無い。正本の削除・付け替え時に掃除する（設計 §4.14） */
export async function cleanupHiddenEdges(
  db: Queryable,
  edgeKind: 'relation' | 'deployment' | 'hosting' | 'app_repository',
  recordId: string,
): Promise<void> {
  await db.query('DELETE FROM diagram_hidden_edges WHERE edge_kind = $1 AND edge_record_id = $2', [edgeKind, recordId]);
}
