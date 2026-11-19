import { createPool } from './pool.js';
import { migrate } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const pool = createPool(url);
try {
  const { rows } = await pool.query<{ v: number }>(`SELECT current_setting('server_version_num')::int AS v`);
  if ((rows[0]?.v ?? 0) < 180000) {
    throw new Error('Mikke requires PostgreSQL 18 or later (uuidv7)');
  }
  const applied = await migrate(pool);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
} finally {
  await pool.end();
}
