import type { Queryable } from '../db/pool.js';

const toParam = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

/**
 * patch のうち allowed に含まれ undefined でないキーだけで UPDATE を組み立てる。
 * 列名はホワイトリスト（allowed）からのみ埋め込む。
 */
export async function updateColumns<T>(
  db: Queryable,
  table: string,
  keyColumn: string,
  key: string,
  patch: Record<string, unknown>,
  allowed: readonly string[],
): Promise<T | undefined> {
  const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && allowed.includes(k));
  if (entries.length === 0) {
    const res = await db.query(`SELECT * FROM ${table} WHERE ${keyColumn} = $1`, [key]);
    return res.rows[0] as T | undefined;
  }
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const res = await db.query(`UPDATE ${table} SET ${sets} WHERE ${keyColumn} = $1 RETURNING *`, [
    key,
    ...entries.map(([, v]) => toParam(v)),
  ]);
  return res.rows[0] as T | undefined;
}

export async function insertRow<T>(db: Queryable, table: string, row: Record<string, unknown>): Promise<T> {
  const entries = Object.entries(row).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => k).join(', ');
  const params = entries.map((_, i) => `$${i + 1}`).join(', ');
  const res = await db.query(`INSERT INTO ${table} (${cols}) VALUES (${params}) RETURNING *`, entries.map(([, v]) => toParam(v)));
  return res.rows[0] as T;
}
