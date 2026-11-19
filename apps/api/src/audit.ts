import type { Queryable } from './db/pool.js';

export type AuditAction =
  | 'create'
  | 'update'
  | 'archive'
  | 'restore'
  | 'delete'
  | 'assign_release_cycle'
  | 'request_change'
  | 'approve'
  | 'reject'
  | 'supersede';

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** 正本変更と同一トランザクション内で呼ぶこと */
export async function recordAudit(db: Queryable, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.actorId, e.action, e.entityType, e.entityId, toJson(e.before), toJson(e.after)],
  );
}

const toJson = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
