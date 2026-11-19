import { z } from 'zod';
import type { Queryable } from '../db/pool.js';
import { many } from '../db/pool.js';
import { isoDate, parse, uuid } from '../lib/validation.js';
import { versionMatches } from '../lib/version.js';
import { EOL_TARGETS_SQL } from './common.js';
import { TARGET_KINDS } from './software.js';

export const EOL_STATUSES = ['eol', 'approaching_eol', 'supported', 'unknown'] as const;
export type EolStatus = (typeof EOL_STATUSES)[number];

export interface EolSettings {
  eolWarningDays: number;
  eolStaleDays: number;
}

interface Row {
  target_kind: (typeof TARGET_KINDS)[number];
  target_id: string;
  resource_id: string;
  resource_name: string;
  resource_type: string;
  software_product_id: string | null;
  product_name: string | null;
  release_cycle_id: string | null;
  version: string | null;
  cycle: string | null;
  match_pattern: string | null;
  verification_status: string | null;
  verified_at: string | null;
  eol_date: string | null;
  eol_checked_at: string | null;
  eol_source_url: string | null;
  sec_date: string | null;
  sec_checked_at: string | null;
  sec_source_url: string | null;
}

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/**
 * 判定規則（設計 §12.1）
 * - 明示的な eol を優先。無ければ security_support_end を終了日とする。active_support_end のみでは断定しない
 * - 製品/系列未特定・終了日未登録・disputed は unknown
 * - 根拠の確認日時（checked_at）が古ければ stale
 */
export function evaluate(row: Row, asOf: string, s: EolSettings) {
  const base = {
    end_date: null as string | null,
    end_basis: null as 'eol' | 'security_support_end' | null,
    days_remaining: null as number | null,
    source_url: null as string | null,
    checked_at: null as string | null,
    stale: null as boolean | null,
  };
  const unknown = (reason: string) => ({ ...base, status: 'unknown' as EolStatus, reason });
  if (!row.software_product_id) return unknown('product_not_identified');
  if (!row.release_cycle_id) return unknown('release_cycle_not_assigned');
  if (row.verification_status === 'disputed') return unknown('release_cycle_disputed');
  // 割当後に版が変わり系列と一致しなくなった場合、その系列の期限で判定しない
  if (!versionMatches(row.version, row.cycle!, row.match_pattern)) return unknown('version_cycle_mismatch');

  const [end, basis, checked, source] = row.eol_date
    ? [row.eol_date, 'eol' as const, row.eol_checked_at, row.eol_source_url]
    : row.sec_date
      ? [row.sec_date, 'security_support_end' as const, row.sec_checked_at, row.sec_source_url]
      : [null, null, null, null];
  if (!end) return unknown('end_date_not_registered');

  const remaining = daysBetween(asOf, end);
  const status: EolStatus = remaining < 0 ? 'eol' : remaining <= s.eolWarningDays ? 'approaching_eol' : 'supported';
  const stale = !checked || daysBetween(checked.slice(0, 10), asOf) > s.eolStaleDays;
  return {
    ...base,
    status,
    reason: null,
    end_date: end,
    end_basis: basis,
    days_remaining: remaining,
    source_url: source,
    checked_at: checked,
    stale,
  };
}

const querySchema = z.object({
  status: z.enum(EOL_STATUSES).optional(),
  target_kind: z.enum(TARGET_KINDS).optional(),
  software_product_id: uuid.optional(),
  resource_id: uuid.optional(),
  stale: z.enum(['true', 'false']).optional(),
  as_of: isoDate.optional(),
});

/** 稼働中の管理対象資産だけを対象にEOL状態を一覧する（アーカイブ済み・retired は除外） */
export async function listEolStatus(db: Queryable, settings: EolSettings, query: unknown) {
  const f = parse(querySchema, query);
  const asOf = f.as_of ?? new Date().toISOString().slice(0, 10);
  const rows = await many<Row>(
    db,
    `SELECT t.*, r.name AS resource_name, r.resource_type,
            p.name AS product_name,
            c.cycle, c.match_pattern, c.verification_status, c.verified_at,
            eol.event_date AS eol_date, eol.checked_at AS eol_checked_at, eol.source_url AS eol_source_url,
            sec.event_date AS sec_date, sec.checked_at AS sec_checked_at, sec.source_url AS sec_source_url
       FROM (${EOL_TARGETS_SQL}) t
       JOIN resources r ON r.id = t.resource_id
       LEFT JOIN software_products p ON p.id = t.software_product_id
       LEFT JOIN software_release_cycles c ON c.id = t.release_cycle_id
       LEFT JOIN software_lifecycle_events eol ON eol.release_cycle_id = c.id AND eol.event_type = 'eol'
       LEFT JOIN software_lifecycle_events sec ON sec.release_cycle_id = c.id AND sec.event_type = 'security_support_end'
      WHERE ($1::text IS NULL OR t.target_kind = $1)
        AND ($2::uuid IS NULL OR t.software_product_id = $2)
        AND ($3::uuid IS NULL OR t.resource_id = $3)
      ORDER BY r.name, t.target_kind, p.name NULLS LAST, t.target_id`,
    [f.target_kind ?? null, f.software_product_id ?? null, f.resource_id ?? null],
  );

  const items = rows
    .map((row) => {
      const ev = evaluate(row, asOf, settings);
      return {
        target_kind: row.target_kind,
        target_id: row.target_id,
        resource: { id: row.resource_id, name: row.resource_name, resource_type: row.resource_type },
        product: row.software_product_id ? { id: row.software_product_id, name: row.product_name } : null,
        version: row.version,
        release_cycle: row.release_cycle_id
          ? {
              id: row.release_cycle_id,
              cycle: row.cycle,
              verification_status: row.verification_status,
              verified_at: row.verified_at,
            }
          : null,
        // 系列の照合が人/Agentにより確認されていない（判定はするが注意表示する）
        needs_verification: row.release_cycle_id ? row.verification_status !== 'verified' : null,
        // 割当後にバージョンが変わり系列と食い違った場合の注意フラグ
        cycle_mismatch: row.release_cycle_id ? !versionMatches(row.version, row.cycle!, row.match_pattern) : null,
        ...ev,
      };
    })
    .filter((i) => (!f.status || i.status === f.status) && (!f.stale || String(i.stale) === f.stale));

  const summary = Object.fromEntries(EOL_STATUSES.map((s) => [s, items.filter((i) => i.status === s).length]));
  return {
    as_of: asOf,
    thresholds: { warning_days: settings.eolWarningDays, stale_days: settings.eolStaleDays },
    summary: {
      ...summary,
      stale: items.filter((i) => i.stale).length,
      needs_verification: items.filter((i) => i.needs_verification).length,
    },
    items,
  };
}
