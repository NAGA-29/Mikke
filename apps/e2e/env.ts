import { createHash } from 'node:crypto';

// e2e 専用。実データのDB・トークンとは無関係な固定値（ローカル/CIの使い捨てDBでのみ使う）
export const E2E_TOKEN = 'mikke_e2e_admin_token_for_tests_only';
export const E2E_ACTOR = 'e2e:admin';
// 承認権限の無い主体（EOL日付変更が承認待ちになることの確認用）
export const E2E_WRITER_TOKEN = 'mikke_e2e_writer_token_for_tests_only';
export const API_PORT = Number(process.env.E2E_API_PORT ?? 18080);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 15173);
export const ADMIN_DATABASE_URL = process.env.E2E_ADMIN_DATABASE_URL ?? 'postgres://mikke:mikke@localhost:5432/postgres';
export const E2E_DB_NAME = 'mikke_e2e';
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? ADMIN_DATABASE_URL.replace(/\/[^/]*$/, `/${E2E_DB_NAME}`);

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export const TOKENS_JSON = JSON.stringify([
  {
    actor_id: 'e2e:writer',
    token_sha256: sha(E2E_WRITER_TOKEN),
    scopes: ['mikke:read', 'mikke:write'],
  },
  {
    actor_id: E2E_ACTOR,
    token_sha256: sha(E2E_TOKEN),
    scopes: ['mikke:read', 'mikke:write', 'mikke:eol:approve', 'mikke:admin'],
  },
]);
