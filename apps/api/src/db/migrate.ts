import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../db/migrations');

// 複数プロセスから同時に migrate しても二重適用しないためのセッションレベル advisory lock のキー
const MIGRATION_LOCK_KEY = 7_401_329_011;

/**
 * db/migrations/*.sql をファイル名順に未適用分だけ1ファイル1トランザクションで適用する。
 * 履歴テーブル作成の前から全適用の終了まで、専用接続で advisory lock を保持する。
 */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      // ロック取得後に読むので、先行プロセスが適用した分はスキップされる
      const applied = new Set(
        (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version),
      );
      const done: string[] = [];
      for (const file of files) {
        if (applied.has(file)) continue;
        const sql = await readFile(path.join(dir, file), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
          await client.query('COMMIT');
          done.push(file);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`migration ${file} failed: ${(err as Error).message}`);
        }
      }
      return done;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
