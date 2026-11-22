import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { hashToken } from '../src/auth.js';
import type { Scope } from '../src/config.js';
import { create, ok, pool } from './helpers.js';

const TOKEN = 'mcp-test-principal-token';
const ACTOR = 'agent:mcp-test';
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function connect(scopes: Scope[] = ['mikke:read', 'mikke:write']) {
  const server = createMcpServer(
    {
      pool,
      config: {
        tokens: [{ actor_id: ACTOR, token_sha256: hashToken(TOKEN), scopes }],
        eolWarningDays: 90,
        eolStaleDays: 180,
      },
    },
    TOKEN,
  );
  const client = new Client({ name: 'mikke-integration-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

async function invoke(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { result, body: JSON.parse(content[0]!.text) };
}
async function success(client: Client, name: string, args: Record<string, unknown> = {}) {
  const { result, body } = await invoke(client, name, args);
  expect(result.isError, JSON.stringify(body)).toBe(false);
  return body.data;
}
const eventInput = (cycleId: string) => ({
  release_cycle_id: cycleId,
  event_type: 'eol',
  event_date: '2030-11-14',
  source_url: 'https://www.postgresql.org/support/versioning/',
  source_title: 'Official support policy (test fixture)',
  checked_at: '2026-01-01T00:00:00Z',
  notes: null,
});

async function research(client: Client) {
  // 登録済み製品は調査開始前の管理対象データ。以後の操作はMCPのみ。
  const product = await create.product('PostgreSQL', { vendor: 'PostgreSQL' });
  const lifecycle = await success(client, 'get_software_lifecycle', { q: 'PostgreSQL' });
  expect(lifecycle.items[0].product.id).toBe(product.id);
  const resource = await success(client, 'create_resource', {
    input: {
      resource_type: 'service_instance',
      name: 'research-db',
      detail: { service_kind: 'database', engine: 'PostgreSQL', engine_version: '18.1', software_product_id: product.id },
    },
  });
  const cycle = await success(client, 'create_software_release_cycle', {
    input: {
      software_product_id: product.id,
      cycle: '18',
      verification_status: 'verified',
      verified_at: '2026-01-01T00:00:00Z',
    },
  });
  const event = await success(client, 'create_lifecycle_event', { input: eventInput(cycle.id) });
  const assignment = await success(client, 'assign_release_cycle', {
    target_kind: 'service_instance',
    target_id: resource.id,
    input: { release_cycle_id: cycle.id },
  });
  expect(assignment.changed).toBe(true);
  const status = await success(client, 'list_eol_status', { resource_id: resource.id, as_of: '2030-10-01' });
  expect(status.items).toHaveLength(1);
  expect(status.items[0]).toMatchObject({ status: 'approaching_eol', end_date: '2030-11-14', product: { id: product.id } });
  const reread = await success(client, 'get_software_lifecycle', { software_product_id: product.id });
  expect(reread.items[0].release_cycles[0].events[0].id).toBe(event.id);
  return { resource, product, cycle, event };
}

describe('MCP over SDK InMemoryTransport with PostgreSQL', () => {
  it('exposes exactly the initial tools, with no destructive operations even for admin', async () => {
    const client = await connect(['mikke:admin']);
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(
      [
        'search_resources',
        'get_resource',
        'get_application_deployments',
        'get_resource_dependencies',
        'get_resource_graph',
        'search_software_installations',
        'list_eol_status',
        'get_software_lifecycle',
        'create_resource',
        'update_resource',
        'create_software_release_cycle',
        'update_software_release_cycle',
        'create_lifecycle_event',
        'update_lifecycle_event',
        'assign_release_cycle',
      ].sort(),
    );
    const result = await client.callTool({ name: 'archive_resource', arguments: {} });
    expect(result.isError).toBe(true);
  });

  it('resolves token principal and rejects missing/invalid tokens', () => {
    const deps = { pool, config: { tokens: [], eolWarningDays: 90, eolStaleDays: 180 } };
    expect(() => createMcpServer(deps, '')).toThrow('MIKKE_MCP_TOKEN is required');
    expect(() => createMcpServer(deps, TOKEN)).toThrow('invalid token');
  });

  it('enforces read/write scopes independently and admin includes them', async () => {
    const reader = await connect(['mikke:read']);
    const denied = await invoke(reader, 'create_resource', { input: { resource_type: 'application', name: 'denied' } });
    expect(denied.result.isError).toBe(true);
    expect(denied.body.error.code).toBe('insufficient_scope');
    const writer = await connect(['mikke:write']);
    expect((await invoke(writer, 'search_resources')).body.error.code).toBe('insufficient_scope');
    const admin = await connect(['mikke:admin']);
    await success(admin, 'create_resource', { input: { resource_type: 'application', name: 'admin-created' } });
    const rows = await pool.query('SELECT actor_id FROM audit_logs');
    expect(rows.rows).toEqual([{ actor_id: ACTOR }]);
  });

  it('completes §12.2 research and records canonical writes and token actor in audit logs', async () => {
    const client = await connect();
    const { resource, cycle, event } = await research(client);
    const rows = await pool.query('SELECT actor_id, entity_type, action FROM audit_logs WHERE actor_id = $1', [ACTOR]);
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        { actor_id: ACTOR, entity_type: 'resource', action: 'create' },
        { actor_id: ACTOR, entity_type: 'software_release_cycle', action: 'create' },
        { actor_id: ACTOR, entity_type: 'software_lifecycle_event', action: 'create' },
        { actor_id: ACTOR, entity_type: 'resource', action: 'assign_release_cycle' },
      ]),
    );
    expect(event.recorded_by).toBe(ACTOR);
    expect((await success(client, 'get_resource', { id: resource.id })).detail.release_cycle_id).toBe(cycle.id);
    const repeated = await success(client, 'create_lifecycle_event', { input: eventInput(cycle.id) });
    expect(repeated).toMatchObject({ id: event.id, idempotent: true });
  });

  it('returns 202-equivalent pending approval, keeps the event unchanged, enforces optimistic locking', async () => {
    const client = await connect();
    const { event } = await research(client);
    const input = {
      event_date: '2031-11-14',
      source_url: event.source_url,
      source_title: event.source_title,
      checked_at: '2026-01-02T00:00:00Z',
      notes: 'Published revision (test fixture)',
      expected_updated_at: event.updated_at,
    };
    const pending = await invoke(client, 'update_lifecycle_event', { id: event.id, input });
    expect(pending.result.isError).toBe(false);
    expect(pending.body).toMatchObject({
      status: 'pending_approval',
      status_code: 202,
      data: {
        pending_approval: true,
        change_request: {
          requested_by: ACTOR,
          status: 'pending',
          before_data: { event_date: event.event_date },
          proposed_data: { event_date: input.event_date },
        },
      },
    });
    const stored = await pool.query('SELECT event_date FROM software_lifecycle_events WHERE id = $1', [event.id]);
    expect(stored.rows[0].event_date).toBe(event.event_date);
    const audit = await pool.query('SELECT actor_id FROM audit_logs WHERE entity_id = $1', [pending.body.data.change_request.id]);
    expect(audit.rows).toEqual([{ actor_id: ACTOR }]);
    const stale = await invoke(client, 'update_lifecycle_event', {
      id: event.id,
      input: { ...input, expected_updated_at: '2000-01-01T00:00:00.000001Z' },
    });
    expect(stale.result.isError).toBe(true);
    expect(stale.body.error.code).toBe('stale_update');
    const approver = await connect(['mikke:write', 'mikke:eol:approve']);
    const applied = await success(approver, 'update_lifecycle_event', { id: event.id, input });
    expect(applied.event_date).toBe(input.event_date);
  });

  it('rejects actor spoofing, unknown dates and credential input without leaking the raw token', async () => {
    const client = await connect();
    for (const args of [
      { [TOKEN]: 'unknown argument', input: { resource_type: 'application', name: 'bad' } },
      { actor_id: 'spoofed', input: { resource_type: 'application', name: 'bad' } },
      { input: { resource_type: 'application', name: 'bad', actor_id: 'spoofed' } },
      {
        input: {
          resource_type: 'service_instance',
          name: 'bad',
          detail: { service_kind: 'database', endpoint: `https://user:${TOKEN}@db.example/` },
        },
      },
    ]) {
      const result = await client.callTool({ name: 'create_resource', arguments: args });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
    expect((await pool.query('SELECT * FROM resources')).rows).toHaveLength(0);
    expect((await pool.query('SELECT * FROM audit_logs')).rows).toHaveLength(0);
    const { cycle } = await research(client);
    for (const input of [
      { ...eventInput(cycle.id), event_date: null },
      { ...eventInput(cycle.id), recorded_by: 'spoofed' },
      { ...eventInput(cycle.id), source_url: `https://example.com/?token=${TOKEN}` },
    ]) {
      const result = await client.callTool({ name: 'create_lifecycle_event', arguments: { input } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });

  it('rolls back both cycle and audit when atomic assign_to fails', async () => {
    const client = await connect();
    const product = await create.product('Rollback product');
    const host = await create.compute('retired-host', { os_software_product_id: product.id, os_name: 'test', os_version: '1.2' });
    await ok('PATCH', `/resources/${host.id}`, { body: { lifecycle_status: 'retired' } });
    const count = (await pool.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n;
    const denied = await invoke(client, 'create_software_release_cycle', {
      input: {
        software_product_id: product.id,
        cycle: '1',
        assign_to: { target_kind: 'compute_os', target_id: host.id },
      },
    });
    expect(denied.body.error.code).toBe('release_cycle_not_in_use');
    expect((await pool.query('SELECT * FROM software_release_cycles')).rows).toHaveLength(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n).toBe(count);
  });
});
