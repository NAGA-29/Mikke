import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

/** テストDBのスキーマを作り直してマイグレーションを適用する */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://mikke:mikke@localhost:5432/mikke_test';
  if (!/test/.test(url)) throw new Error(`refusing to reset a non-test database: ${url}`);
  const pool = createPool(url);
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
