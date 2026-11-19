import { afterAll, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/auth.js';
import type { Scope } from '../src/config.js';
import { createPool } from '../src/db/pool.js';

const TOKENS: Record<string, { actor: string; scopes: Scope[] }> = {
  reader: { actor: 'test:reader', scopes: ['mikke:read'] },
  writer: { actor: 'test:writer', scopes: ['mikke:read', 'mikke:write'] },
  approver: { actor: 'test:approver', scopes: ['mikke:read', 'mikke:write', 'mikke:eol:approve'] },
  approver2: { actor: 'test:approver2', scopes: ['mikke:read', 'mikke:write', 'mikke:eol:approve'] },
  admin: { actor: 'test:admin', scopes: ['mikke:admin'] },
};
export type Who = keyof typeof TOKENS;

export const pool = createPool(process.env.DATABASE_URL!);
export const app = createApp({
  pool,
  config: {
    tokens: Object.entries(TOKENS).map(([token, t]) => ({
      actor_id: t.actor,
      token_sha256: hashToken(token),
      scopes: t.scopes,
    })),
    eolWarningDays: 90,
    eolStaleDays: 180,
  },
});

const TABLES = [
  'audit_logs',
  'lifecycle_event_change_requests',
  'diagram_hidden_edges',
  'diagram_nodes',
  'diagrams',
  'resource_relations',
  'deployments',
  'application_repositories',
  'software_installations',
  'software_lifecycle_events',
  'service_instances',
  'compute_assets',
  'applications',
  'repositories',
  'resources',
  'software_release_cycles',
  'software_products',
];

beforeEach(async () => {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
});
afterAll(async () => {
  await pool.end();
});

export interface Res<T = any> {
  status: number;
  body: T;
}

export async function call<T = any>(method: string, path: string, opts: { as?: Who | null; body?: unknown } = {}): Promise<Res<T>> {
  const who = opts.as === undefined ? 'writer' : opts.as;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${who}`;
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** 期待ステータスでなければ本文付きで失敗させる */
export async function ok<T = any>(method: string, path: string, opts: { as?: Who | null; body?: unknown } = {}, expected = [200, 201, 204]) {
  const r = await call<T>(method, path, opts);
  if (!expected.includes(r.status)) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}

export const create = {
  compute: (name: string, detail: Record<string, unknown> = {}) =>
    ok('POST', '/resources', { body: { resource_type: 'compute', name, environment: 'prod', detail: { asset_kind: 'vps', ...detail } } }),
  app: (name: string, detail: Record<string, unknown> = {}) =>
    ok('POST', '/resources', { body: { resource_type: 'application', name, detail } }),
  service: (name: string, detail: Record<string, unknown>) =>
    ok('POST', '/resources', { body: { resource_type: 'service_instance', name, environment: 'prod', detail } }),
  repo: (name: string, url: string) =>
    ok('POST', '/resources', { body: { resource_type: 'repository', name, detail: { provider: 'GitHub', repository_url: url } } }),
  product: (name: string, extra: Record<string, unknown> = {}) => ok('POST', '/software/products', { body: { name, ...extra } }),
};
