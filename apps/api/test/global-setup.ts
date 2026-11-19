import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

/** テストDBのスキーマを作り直してマイグレーションを適用する */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://mikke:mikke@localhost:5432/mikke_test';
  // URL全体ではなくデータベース名だけを見る（パスワード等に "test" を含む本番URLを誤って初期化しないため）
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!/_test$/.test(dbName)) {
    throw new Error(`refusing to reset database "${dbName}": test database names must end with _test`);
  }
  const pool = createPool(url);
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
