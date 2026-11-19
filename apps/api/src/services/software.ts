import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Actor } from '../auth.js';
import { hasScope } from '../auth.js';
import { recordAudit } from '../audit.js';
import type { Queryable } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { conflict, forbidden, invalid, notFound } from '../errors.js';
import { insertRow, updateColumns } from '../lib/sql.js';
import { httpUrl, isoDate, optStr, optTimestamp, parse, reqStr, timestamp, uuid } from '../lib/validation.js';
import { isValidPattern, versionMatches } from '../lib/version.js';
import { EOL_TARGETS_SQL, requireResource, type EolTargetRow } from './common.js';

// ===========================================================================
// software_products
// ===========================================================================

export const normalizeProductName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

const productSchema = z.strictObject({
  name: reqStr(255),
  vendor: optStr(255),
  category: optStr(50),
});

interface ProductRow {
  id: string;
  name: string;
  normalized_name: string;
  vendor: string | null;
}

export async function createProduct(tx: PoolClient, actor: Actor, body: unknown) {
  const input = parse(productSchema, body);
  const normalized_name = normalizeProductName(input.name);
  const existing = await one<ProductRow>(
    tx,
    `SELECT * FROM software_products WHERE normalized_name = $1 AND coalesce(lower(vendor), '') = coalesce(lower($2), '')`,
    [normalized_name, input.vendor ?? null],
  );
  if (existing) throw conflict('already_exists', 'software product already exists', { existing });
  const row = await insertRow<ProductRow>(tx, 'software_products', { ...input, normalized_name });
  await recordAudit(tx, { actorId: actor.id, action: 'create', entityType: 'software_product', entityId: row.id, after: row });
  return row;
}

export async function updateProduct(tx: PoolClient, actor: Actor, id: string, body: unknown) {
  const input = parse(productSchema.partial(), body);
  const before = await one<ProductRow>(tx, 'SELECT * FROM software_products WHERE id = $1 FOR UPDATE', [id]);
  if (!before) throw notFound('software product', id);
  const patch = { ...input, ...(input.name ? { normalized_name: normalizeProductName(input.name) } : {}) };
  const after = await updateColumns(tx, 'software_products', 'id', id, patch, ['name', 'normalized_name', 'vendor', 'category']);
  await recordAudit(tx, { actorId: actor.id, action: 'update', entityType: 'software_product', entityId: id, before, after });
  return after;
}

export async function listProducts(db: Queryable, query: unknown) {
  const f = parse(z.object({ q: z.string().trim().max(255).optional() }), query);
  return many(
    db,
    `SELECT * FROM software_products
      WHERE $1::text IS NULL OR normalized_name LIKE '%' || $1 || '%'
      ORDER BY normalized_name, vendor NULLS FIRST`,
    [f.q ? normalizeProductName(f.q) : null],
  );
}

export async function getProduct(db: Queryable, id: string) {
  const row = await one(db, 'SELECT * FROM software_products WHERE id = $1', [id]);
  if (!row) throw notFound('software product', id);
  return row;
}

// ===========================================================================
// software_installations
// ===========================================================================

const installationFields = {
  version: optStr(255),
  install_method: optStr(100),
  install_path: z.string().max(2048).nullable().optional(),
  config_path: z.string().max(2048).nullable().optional(),
  last_verified_at: optTimestamp,
};
const createInstallationSchema = z.strictObject({
  compute_asset_id: uuid,
  software_product_id: uuid,
  ...installationFields,
});
const patchInstallationSchema = z.strictObject(installationFields).partial();

interface InstallationRow {
  id: string;
  compute_asset_id: string;
  software_product_id: string;
  version: string | null;
  release_cycle_id: string | null;
}

export async function createInstallation(tx: PoolClient, actor: Actor, body: unknown) {
  const input = parse(createInstallationSchema, body);
  await requireResource(tx, input.compute_asset_id, { types: ['compute'], label: 'compute asset' });
  await getProduct(tx, input.software_product_id);
  const row = await insertRow<InstallationRow>(tx, 'software_installations', input);
  await recordAudit(tx, { actorId: actor.id, action: 'create', entityType: 'software_installation', entityId: row.id, after: row });
  return row;
}

export async function updateInstallation(tx: PoolClient, actor: Actor, id: string, body: unknown) {
  const input = parse(patchInstallationSchema, body);
  const before = await one<InstallationRow>(tx, 'SELECT * FROM software_installations WHERE id = $1 FOR UPDATE', [id]);
  if (!before) throw notFound('software installation', id);
  await requireResource(tx, before.compute_asset_id, { label: 'compute asset' });
  const after = await updateColumns(tx, 'software_installations', 'id', id, input, Object.keys(installationFields));
  await recordAudit(tx, { actorId: actor.id, action: 'update', entityType: 'software_installation', entityId: id, before, after });
  return after;
}

export async function getInstallation(db: Queryable, id: string) {
  const row = await one(db, 'SELECT * FROM software_installations WHERE id = $1', [id]);
  if (!row) throw notFound('software installation', id);
  return row;
}

export async function listInstallations(db: Queryable, query: unknown) {
  const f = parse(
    z.object({
      compute_asset_id: uuid.optional(),
      software_product_id: uuid.optional(),
      version: z.string().max(255).optional(),
      include_archived: z.enum(['true', 'false']).optional(),
    }),
    query,
  );
  return many(
    db,
    `SELECT si.*, p.name AS product_name, r.name AS compute_name, (r.archived_at IS NOT NULL) AS compute_archived,
            c.cycle AS release_cycle
       FROM software_installations si
       JOIN software_products p ON p.id = si.software_product_id
       JOIN resources r ON r.id = si.compute_asset_id
       LEFT JOIN software_release_cycles c ON c.id = si.release_cycle_id
      WHERE ($1::uuid IS NULL OR si.compute_asset_id = $1)
        AND ($2::uuid IS NULL OR si.software_product_id = $2)
        AND ($3::text IS NULL OR si.version = $3)
        AND ($4::boolean OR r.archived_at IS NULL)
      ORDER BY p.normalized_name, si.version, si.id`,
    [f.compute_asset_id ?? null, f.software_product_id ?? null, f.version ?? null, f.include_archived === 'true'],
  );
}

// ===========================================================================
// release cycle assignment（assign_release_cycle）
// ===========================================================================

export const TARGET_KINDS = ['installation', 'service_instance', 'compute_os'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

interface CycleRow {
  id: string;
  software_product_id: string;
  cycle: string;
  match_pattern: string | null;
  verification_status: 'unverified' | 'verified' | 'disputed';
  updated_at: string;
}

const assignSchema = z.strictObject({
  release_cycle_id: uuid.nullable(),
  allow_version_mismatch: z.boolean().default(false),
});

interface TargetState {
  productId: string | null;
  version: string | null;
  currentCycleId: string | null;
  entityType: string;
  apply: (cycleId: string | null) => Promise<unknown>;
}

async function loadTarget(tx: PoolClient, kind: TargetKind, id: string): Promise<TargetState> {
  if (kind === 'installation') {
    const row = await one<InstallationRow>(tx, 'SELECT * FROM software_installations WHERE id = $1 FOR UPDATE', [id]);
    if (!row) throw notFound('software installation', id);
    await requireResource(tx, row.compute_asset_id, { label: 'compute asset' });
    return {
      productId: row.software_product_id,
      version: row.version,
      currentCycleId: row.release_cycle_id,
      entityType: 'software_installation',
      apply: (c) => one(tx, 'UPDATE software_installations SET release_cycle_id = $2 WHERE id = $1 RETURNING *', [id, c]),
    };
  }
  if (kind === 'service_instance') {
    await requireResource(tx, id, { types: ['service_instance'], lock: true, label: 'service instance' });
    const row = await one<{ software_product_id: string | null; engine_version: string | null; release_cycle_id: string | null }>(
      tx,
      'SELECT * FROM service_instances WHERE resource_id = $1 FOR UPDATE',
      [id],
    );
    return {
      productId: row!.software_product_id,
      version: row!.engine_version,
      currentCycleId: row!.release_cycle_id,
      entityType: 'resource',
      apply: (c) => one(tx, 'UPDATE service_instances SET release_cycle_id = $2 WHERE resource_id = $1 RETURNING *', [id, c]),
    };
  }
  await requireResource(tx, id, { types: ['compute'], lock: true, label: 'compute asset' });
  const row = await one<{ os_software_product_id: string | null; os_version: string | null; os_release_cycle_id: string | null }>(
    tx,
    'SELECT * FROM compute_assets WHERE resource_id = $1 FOR UPDATE',
    [id],
  );
  return {
    productId: row!.os_software_product_id,
    version: row!.os_version,
    currentCycleId: row!.os_release_cycle_id,
    entityType: 'resource',
    apply: (c) => one(tx, 'UPDATE compute_assets SET os_release_cycle_id = $2 WHERE resource_id = $1 RETURNING *', [id, c]),
  };
}

export async function assignReleaseCycle(tx: PoolClient, actor: Actor, kind: TargetKind, id: string, body: unknown) {
  const input = parse(assignSchema, body);
  const target = await loadTarget(tx, kind, id);
  let cycle: CycleRow | undefined;
  if (input.release_cycle_id) {
    cycle = await one<CycleRow>(tx, 'SELECT * FROM software_release_cycles WHERE id = $1', [input.release_cycle_id]);
    if (!cycle) throw notFound('release cycle', input.release_cycle_id);
    if (!target.productId) {
      throw invalid('product_not_set', 'set the software product on the target before assigning a release cycle');
    }
    if (cycle.software_product_id !== target.productId) {
      throw invalid('product_mismatch', 'release cycle belongs to a different software product', {
        target_product_id: target.productId,
        cycle_product_id: cycle.software_product_id,
      });
    }
    if (!input.allow_version_mismatch && !versionMatches(target.version, cycle.cycle, cycle.match_pattern)) {
      throw invalid('version_mismatch', `version ${target.version ?? '(none)'} does not match release cycle ${cycle.cycle}`, {
        version: target.version,
        cycle: cycle.cycle,
        match_pattern: cycle.match_pattern,
      });
    }
  }
  const newId = input.release_cycle_id ?? null;
  if (target.currentCycleId === newId) {
    return { target_kind: kind, target_id: id, release_cycle_id: newId, changed: false };
  }
  await target.apply(newId);
  await recordAudit(tx, {
    actorId: actor.id,
    action: 'assign_release_cycle',
    entityType: target.entityType,
    entityId: id,
    before: { target_kind: kind, release_cycle_id: target.currentCycleId },
    after: { target_kind: kind, release_cycle_id: newId },
  });
  return { target_kind: kind, target_id: id, release_cycle_id: newId, changed: true };
}

// ===========================================================================
// software_release_cycles
// ===========================================================================

const matchPattern = z.string().trim().max(255).refine(isValidPattern, 'match_pattern must be comma-separated version prefixes (e.g. "8.4" or "1.24, 1.25")');

const cycleFields = {
  cycle: reqStr(100),
  match_pattern: matchPattern.nullable(),
  verification_status: z.enum(['unverified', 'verified', 'disputed']),
  verified_at: timestamp.nullable(),
  verified_by: z.string().trim().max(255).nullable(),
  notes: z.string().max(10_000).nullable(),
};

const createCycleSchema = z.strictObject({
  software_product_id: uuid,
  cycle: cycleFields.cycle,
  match_pattern: cycleFields.match_pattern.optional(),
  verification_status: cycleFields.verification_status.default('unverified'),
  verified_at: cycleFields.verified_at.optional(),
  verified_by: cycleFields.verified_by.optional(),
  notes: cycleFields.notes.optional(),
  // 初回登録時に系列作成と資産への紐付けを同一TXで行う（設計 §12.0-3）
  assign_to: z
    .strictObject({
      target_kind: z.enum(TARGET_KINDS),
      target_id: uuid,
      allow_version_mismatch: z.boolean().default(false),
    })
    .optional(),
});

// PUT = 全更新。楽観ロック用 expected_updated_at は必須（設計 §12.2-5）
const putCycleSchema = z.strictObject({ ...cycleFields, expected_updated_at: timestamp });

/** verified にするなら確認日時・確認者を必ず残す */
function fillVerification<T extends { verification_status: string; verified_at?: string | null; verified_by?: string | null }>(
  input: T,
  actor: Actor,
): T {
  if (input.verification_status !== 'verified') return input;
  return { ...input, verified_at: input.verified_at ?? new Date().toISOString(), verified_by: input.verified_by ?? actor.id };
}

async function inServiceTargets(db: Queryable, productId: string): Promise<EolTargetRow[]> {
  return many<EolTargetRow>(db, `SELECT * FROM (${EOL_TARGETS_SQL}) t WHERE t.software_product_id = $1`, [productId]);
}

/**
 * 系列が「Mikkeの稼働中管理対象資産に関係するか」（設計 §12.0）
 * - その系列が稼働中の対象に割り当て済み、または
 * - 同じ製品の稼働中対象のバージョンが系列の照合規則に一致する
 */
async function isCycleRelevant(db: Queryable, productId: string, cycleId: string | null, cycle: string, pattern: string | null) {
  const targets = await inServiceTargets(db, productId);
  return targets.some((t) => (cycleId && t.release_cycle_id === cycleId) || versionMatches(t.version, cycle, pattern));
}

export async function createReleaseCycle(tx: PoolClient, actor: Actor, body: unknown) {
  const { assign_to, ...input } = fillVerification(parse(createCycleSchema, body), actor);
  await getProduct(tx, input.software_product_id);
  const existing = await one<CycleRow>(
    tx,
    'SELECT * FROM software_release_cycles WHERE software_product_id = $1 AND cycle = $2',
    [input.software_product_id, input.cycle],
  );
  if (existing) throw conflict('already_exists', 'release cycle already exists for this product', { existing });

  if (!assign_to && !(await isCycleRelevant(tx, input.software_product_id, null, input.cycle, input.match_pattern ?? null))) {
    throw invalid(
      'release_cycle_not_in_use',
      'no in-service asset uses this product/cycle; Mikke only tracks EOL for cycles in use (specify assign_to to link an asset)',
    );
  }
  const row = await insertRow<CycleRow>(tx, 'software_release_cycles', input);
  await recordAudit(tx, { actorId: actor.id, action: 'create', entityType: 'software_release_cycle', entityId: row.id, after: row });
  let assignment;
  if (assign_to) {
    assignment = await assignReleaseCycle(tx, actor, assign_to.target_kind, assign_to.target_id, {
      release_cycle_id: row.id,
      allow_version_mismatch: assign_to.allow_version_mismatch,
    });
  }
  return { ...row, assignment };
}

export async function updateReleaseCycle(tx: PoolClient, actor: Actor, id: string, body: unknown) {
  const { expected_updated_at, ...input } = fillVerification(parse(putCycleSchema, body), actor);
  const before = await one<CycleRow>(tx, 'SELECT * FROM software_release_cycles WHERE id = $1 FOR UPDATE', [id]);
  if (!before) throw notFound('release cycle', id);
  assertNotStale(before.updated_at, expected_updated_at, before);
  const after = await updateColumns(tx, 'software_release_cycles', 'id', id, input, Object.keys(cycleFields));
  await recordAudit(tx, { actorId: actor.id, action: 'update', entityType: 'software_release_cycle', entityId: id, before, after });
  return after;
}

const CYCLE_SELECT = `
  SELECT c.*, p.name AS product_name,
         COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_date) FROM software_lifecycle_events e
                    WHERE e.release_cycle_id = c.id), '[]'::jsonb) AS events,
         (SELECT count(*)::int FROM (${EOL_TARGETS_SQL}) t WHERE t.release_cycle_id = c.id) AS in_service_assignments
    FROM software_release_cycles c
    JOIN software_products p ON p.id = c.software_product_id`;

export async function listReleaseCycles(db: Queryable, query: unknown) {
  const f = parse(z.object({ software_product_id: uuid.optional() }), query);
  return many(db, `${CYCLE_SELECT} WHERE ($1::uuid IS NULL OR c.software_product_id = $1) ORDER BY p.normalized_name, c.cycle`, [
    f.software_product_id ?? null,
  ]);
}

export async function getReleaseCycle(db: Queryable, id: string) {
  const row = await one(db, `${CYCLE_SELECT} WHERE c.id = $1`, [id]);
  if (!row) throw notFound('release cycle', id);
  return row;
}

// ===========================================================================
// software_lifecycle_events
// ===========================================================================

const notFuture = (v: string) => Date.parse(v) <= Date.now() + 5 * 60_000;

const eventFields = {
  event_date: isoDate,
  source_url: httpUrl,
  source_title: z.string().max(1000).nullable(),
  checked_at: timestamp.refine(notFuture, 'checked_at must not be in the future'),
  notes: z.string().max(10_000).nullable(),
};

const createEventSchema = z.strictObject({
  release_cycle_id: uuid,
  event_type: z.enum(['release', 'active_support_end', 'security_support_end', 'eol']),
  event_date: eventFields.event_date,
  source_url: eventFields.source_url,
  source_title: eventFields.source_title.optional(),
  checked_at: eventFields.checked_at,
  notes: eventFields.notes.optional(),
});

const putEventSchema = z.strictObject({ ...eventFields, expected_updated_at: timestamp });

interface EventRow {
  id: string;
  release_cycle_id: string;
  event_type: string;
  event_date: string;
  source_url: string;
  updated_at: string;
}

function assertNotStale(current: string, expected: string, record: unknown) {
  if (Date.parse(current) !== Date.parse(expected) || normalizeMicros(current) !== normalizeMicros(expected)) {
    throw conflict('stale_update', 'record was modified by someone else; re-fetch and retry', { current: record });
  }
}
/** Date.parse はミリ秒までしか見ないので、マイクロ秒部分も比較する */
function normalizeMicros(ts: string): string {
  const m = /\.(\d+)/.exec(ts);
  return (m?.[1] ?? '').padEnd(6, '0').slice(0, 6);
}

/**
 * EOL等のイベント登録。登録者は認証主体（recorded_by は入力させない）。
 * 同一内容の再登録は冪等に既存を返し、異なる内容なら差分付きで 409 を返す（上書きは PUT + 楽観ロック）。
 */
export async function createLifecycleEvent(tx: PoolClient, actor: Actor, body: unknown) {
  const input = parse(createEventSchema, body);
  const cycle = await one<CycleRow>(tx, 'SELECT * FROM software_release_cycles WHERE id = $1', [input.release_cycle_id]);
  if (!cycle) throw notFound('release cycle', input.release_cycle_id);

  const existing = await one<EventRow>(
    tx,
    'SELECT * FROM software_lifecycle_events WHERE release_cycle_id = $1 AND event_type = $2',
    [input.release_cycle_id, input.event_type],
  );
  if (existing) {
    if (existing.event_date === input.event_date && existing.source_url === input.source_url) {
      return { ...existing, idempotent: true };
    }
    throw conflict('already_exists', 'lifecycle event already exists; use update with expected_updated_at', {
      existing,
      diff: diffFields(existing, input, ['event_date', 'source_url']),
    });
  }
  if (!(await isCycleRelevant(tx, cycle.software_product_id, cycle.id, cycle.cycle, cycle.match_pattern))) {
    throw invalid('release_cycle_not_in_use', 'no in-service asset uses this release cycle; lifecycle events are not tracked');
  }
  const row = await insertRow<EventRow>(tx, 'software_lifecycle_events', { ...input, recorded_by: actor.id });
  await recordAudit(tx, { actorId: actor.id, action: 'create', entityType: 'software_lifecycle_event', entityId: row.id, after: row });
  return row;
}

/** 既存日付の変更は mikke:eol:approve が必要（設計 §12.2-5, §12.3） */
export async function updateLifecycleEvent(tx: PoolClient, actor: Actor, id: string, body: unknown) {
  const { expected_updated_at, ...input } = parse(putEventSchema, body);
  const before = await one<EventRow>(tx, 'SELECT * FROM software_lifecycle_events WHERE id = $1 FOR UPDATE', [id]);
  if (!before) throw notFound('lifecycle event', id);
  assertNotStale(before.updated_at, expected_updated_at, before);
  if (before.event_date !== input.event_date && !hasScope(actor, 'mikke:eol:approve')) {
    throw forbidden('approval_required', 'changing an existing lifecycle date requires mikke:eol:approve', {
      diff: diffFields(before, input, ['event_date', 'source_url']),
    });
  }
  const after = await updateColumns(
    tx,
    'software_lifecycle_events',
    'id',
    id,
    { ...input, recorded_by: actor.id },
    [...Object.keys(eventFields), 'recorded_by'],
  );
  await recordAudit(tx, { actorId: actor.id, action: 'update', entityType: 'software_lifecycle_event', entityId: id, before, after });
  return after;
}

export async function getLifecycleEvent(db: Queryable, id: string) {
  const row = await one(db, 'SELECT * FROM software_lifecycle_events WHERE id = $1', [id]);
  if (!row) throw notFound('lifecycle event', id);
  return row;
}

function diffFields(before: object, after: object, keys: string[]) {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.fromEntries(keys.filter((k) => b[k] !== a[k]).map((k) => [k, { before: b[k], after: a[k] }]));
}
