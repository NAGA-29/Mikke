import pg from 'pg';

// timestamptz はマイクロ秒精度のまま ISO 8601 文字列で扱う（楽観ロックの比較で精度を落とさないため）
pg.types.setTypeParser(1184, (v: string) => v.replace(' ', 'T').replace(/\+00(:00)?$/, 'Z'));
// date はタイムゾーン変換させず 'YYYY-MM-DD' のまま
pg.types.setTypeParser(1082, (v: string) => v);

export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, options: '-c TimeZone=UTC' });
}

export async function withTx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T = Record<string, unknown>>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const res = await db.query(sql, params);
  return res.rows[0] as T | undefined;
}

export async function many<T = Record<string, unknown>>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query(sql, params);
  return res.rows as T[];
}
