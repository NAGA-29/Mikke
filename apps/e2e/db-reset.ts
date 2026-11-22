import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { ADMIN_DATABASE_URL, DATABASE_URL, E2E_DB_NAME } from './env.js';

/**
 * e2e 専用DBを作り直してマイグレーションを適用する（毎回まっさらな状態から始める）。
 * Playwright は webServer を globalSetup より先に起動するため、API 起動コマンドの前段で実行する。
 */
async function main() {
  if (!/_e2e$/.test(E2E_DB_NAME) || !new URL(DATABASE_URL).pathname.endsWith(`/${E2E_DB_NAME}`)) {
    throw new Error(`refusing to reset "${DATABASE_URL}": e2e database name must be ${E2E_DB_NAME}`);
  }
  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${E2E_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${E2E_DB_NAME}`);
  } finally {
    await admin.end();
  }
  execFileSync('pnpm', ['--filter', '@mikke/api', 'migrate'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
