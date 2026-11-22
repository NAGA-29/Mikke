import { Hono, type Context } from 'hono';
import type pg from 'pg';
import { z } from 'zod';
import { authenticate, requireScope, type Actor, type AppEnv } from './auth.js';
import type { Config } from './config.js';
import { many, withTx } from './db/pool.js';
import { AppError, fromPgError, invalid } from './errors.js';
import { parse, uuid } from './lib/validation.js';
import * as deployments from './services/deployments.js';
import * as diagrams from './services/diagrams.js';
import * as eol from './services/eol.js';
import * as relations from './services/relations.js';
import * as resources from './services/resources.js';
import * as software from './services/software.js';

export interface AppDeps {
  pool: pg.Pool;
  config: Pick<Config, 'tokens' | 'eolWarningDays' | 'eolStaleDays'>;
}

export function createApp({ pool, config }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    const e = err instanceof AppError ? err : fromPgError(err);
    if (e) return c.json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
    console.error(err);
    return c.json({ error: { code: 'internal_error', message: 'internal server error' } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'route not found' } }, 404));

  app.get('/healthz', async (c) => {
    await pool.query('SELECT 1');
    return c.json({ ok: true });
  });

  const api = new Hono<AppEnv>();
  api.use('*', authenticate(config.tokens));
  const read = requireScope('mikke:read');
  const write = requireScope('mikke:write');
  const admin = requireScope('mikke:admin');

  const id = (c: Context<AppEnv>, name = 'id') => parse(uuid, c.req.param(name));
  const body = async (c: Context<AppEnv>) => {
    try {
      return await c.req.json();
    } catch {
      throw invalid('invalid_json', 'request body must be JSON');
    }
  };
  const query = (c: Context<AppEnv>) => c.req.query();
  /** 書き込み系はすべて1トランザクション（正本変更＋監査ログ） */
  const tx = <T>(c: Context<AppEnv>, fn: (client: pg.PoolClient, actor: Actor) => Promise<T>) =>
    withTx(pool, (client) => fn(client, c.get('actor')));

  // ---- resources -----------------------------------------------------------
  api.get('/resources', read, async (c) => c.json(await resources.listResources(pool, query(c))));
  api.get('/resources/:id', read, async (c) => c.json(await resources.getResource(pool, id(c))));
  api.get('/resources/:id/references', read, async (c) => c.json(await resources.getReferences(pool, id(c))));
  api.post('/resources', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => resources.createResource(t, a, b)), 201);
  });
  api.patch('/resources/:id', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => resources.updateResource(t, a, id(c), b)));
  });
  api.post('/resources/:id/archive', admin, async (c) => c.json(await tx(c, (t, a) => resources.archiveResource(t, a, id(c)))));
  api.post('/resources/:id/restore', admin, async (c) => c.json(await tx(c, (t, a) => resources.restoreResource(t, a, id(c)))));

  // ---- relations -----------------------------------------------------------
  api.get('/relation-types', read, async (c) => c.json(await relations.listRelationTypes(pool)));
  api.get('/relations', read, async (c) => c.json(await relations.listRelations(pool, query(c))));
  api.get('/relations/:id', read, async (c) => c.json(await relations.getRelation(pool, id(c))));
  api.post('/relations', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => relations.createRelation(t, a, b)), 201);
  });
  api.delete('/relations/:id', write, async (c) => {
    await tx(c, (t, a) => relations.deleteRelation(t, a, id(c)));
    return c.body(null, 204);
  });

  // ---- application repositories -------------------------------------------
  api.get('/application-repositories', read, async (c) => c.json(await relations.listApplicationRepositories(pool, query(c))));
  api.post('/application-repositories', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => relations.createApplicationRepository(t, a, b)), 201);
  });
  api.delete('/application-repositories/:id', write, async (c) => {
    await tx(c, (t, a) => relations.deleteApplicationRepository(t, a, id(c)));
    return c.body(null, 204);
  });

  // ---- deployments ---------------------------------------------------------
  api.get('/deployments', read, async (c) => c.json(await deployments.listDeployments(pool, query(c))));
  api.get('/deployments/:id', read, async (c) => c.json(await deployments.getDeployment(pool, id(c))));
  api.post('/deployments', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => deployments.createDeployment(t, a, b)), 201);
  });
  api.patch('/deployments/:id', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => deployments.updateDeployment(t, a, id(c), b)));
  });

  api.delete('/deployments/:id', write, async (c) => {
    await tx(c, (t, a) => deployments.deleteDeployment(t, a, id(c)));
    return c.body(null, 204);
  });

  // ---- diagrams / graph ----------------------------------------------------
  api.get('/graph', read, async (c) => c.json(await diagrams.getGraph(pool, query(c))));
  api.get('/diagrams', read, async (c) => c.json(await diagrams.listDiagrams(pool, query(c))));
  api.get('/diagrams/:id', read, async (c) => c.json(await diagrams.getDiagram(pool, id(c))));
  api.post('/diagrams', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => diagrams.createDiagram(t, a, b)), 201);
  });
  api.patch('/diagrams/:id', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => diagrams.updateDiagram(t, a, id(c), b)));
  });
  api.delete('/diagrams/:id', write, async (c) => {
    await tx(c, (t, a) => diagrams.deleteDiagram(t, a, id(c)));
    return c.body(null, 204);
  });
  api.get('/diagrams/:id/nodes', read, async (c) => c.json(await diagrams.listNodes(pool, id(c))));
  api.get('/diagrams/:id/nodes/:nodeId', read, async (c) => c.json(await diagrams.getNode(pool, id(c), id(c, 'nodeId'))));
  api.post('/diagrams/:id/nodes', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => diagrams.createNode(t, a, id(c), b)), 201);
  });
  api.patch('/diagrams/:id/nodes/:nodeId', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => diagrams.updateNode(t, a, id(c), id(c, 'nodeId'), b)));
  });
  api.delete('/diagrams/:id/nodes/:nodeId', write, async (c) => {
    await tx(c, (t, a) => diagrams.deleteNode(t, a, id(c), id(c, 'nodeId')));
    return c.body(null, 204);
  });
  api.get('/diagrams/:id/hidden-edges', read, async (c) => c.json(await diagrams.listHiddenEdges(pool, id(c))));
  api.post('/diagrams/:id/hidden-edges', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => diagrams.hideEdge(t, a, id(c), b)), 201);
  });
  api.delete('/diagrams/:id/hidden-edges/:kind/:recordId', write, async (c) => {
    await tx(c, (t, a) => diagrams.unhideEdge(t, a, id(c), c.req.param('kind'), id(c, 'recordId')));
    return c.body(null, 204);
  });

  // ---- software products / installations ----------------------------------
  api.get('/software/products', read, async (c) => c.json(await software.listProducts(pool, query(c))));
  api.get('/software/products/:id', read, async (c) => c.json(await software.getProduct(pool, id(c))));
  api.post('/software/products', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => software.createProduct(t, a, b)), 201);
  });
  api.patch('/software/products/:id', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => software.updateProduct(t, a, id(c), b)));
  });

  api.get('/software/installations', read, async (c) => c.json(await software.listInstallations(pool, query(c))));
  api.get('/software/installations/:id', read, async (c) => c.json(await software.getInstallation(pool, id(c))));
  api.post('/software/installations', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => software.createInstallation(t, a, b)), 201);
  });
  api.patch('/software/installations/:id', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => software.updateInstallation(t, a, id(c), b)));
  });

  // ---- EOL: release cycles / lifecycle events / assignment ------------------
  api.get('/software/release-cycles', read, async (c) => c.json(await software.listReleaseCycles(pool, query(c))));
  api.get('/software/release-cycles/:id', read, async (c) => c.json(await software.getReleaseCycle(pool, id(c))));
  api.post('/software/release-cycles', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => software.createReleaseCycle(t, a, b)), 201);
  });
  api.put('/software/release-cycles/:id', write, async (c) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => software.updateReleaseCycle(t, a, id(c), b)));
  });

  api.get('/software/lifecycle-events/:id', read, async (c) => c.json(await software.getLifecycleEvent(pool, id(c))));
  api.post('/software/lifecycle-events', write, async (c) => {
    const b = await body(c);
    const result = await tx(c, (t, a) => software.createLifecycleEvent(t, a, b));
    return c.json(result, 'idempotent' in result ? 200 : 201);
  });
  api.put('/software/lifecycle-events/:id', write, async (c) => {
    const b = await body(c);
    const result = await tx(c, (t, a) => software.updateLifecycleEvent(t, a, id(c), b));
    // 承認待ちとして受け付けた場合は 202
    return c.json(result, typeof result === 'object' && result !== null && 'pending_approval' in result ? 202 : 200);
  });

  const approve = requireScope('mikke:eol:approve');
  const optionalBody = async (c: Context<AppEnv>) => {
    const text = await c.req.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw invalid('invalid_json', 'request body must be JSON');
    }
  };
  api.get('/software/lifecycle-event-change-requests', read, async (c) => c.json(await software.listChangeRequests(pool, query(c))));
  api.get('/software/lifecycle-event-change-requests/:id', read, async (c) => c.json(await software.getChangeRequest(pool, id(c))));
  api.post('/software/lifecycle-event-change-requests/:id/approve', approve, async (c) => {
    const b = await optionalBody(c);
    return c.json(await tx(c, (t, a) => software.approveChangeRequest(t, a, id(c), b)));
  });
  api.post('/software/lifecycle-event-change-requests/:id/reject', approve, async (c) => {
    const b = await optionalBody(c);
    return c.json(await tx(c, (t, a) => software.rejectChangeRequest(t, a, id(c), b)));
  });

  const assign = (kind: software.TargetKind) => async (c: Context<AppEnv>) => {
    const b = await body(c);
    return c.json(await tx(c, (t, a) => software.assignReleaseCycle(t, a, kind, id(c), b)));
  };
  api.put('/software/installations/:id/release-cycle', write, assign('installation'));
  api.put('/services/:id/release-cycle', write, assign('service_instance'));
  api.put('/compute/:id/os-release-cycle', write, assign('compute_os'));

  api.get('/eol/status', read, async (c) => c.json(await eol.listEolStatus(pool, config, query(c))));

  // ---- audit logs ----------------------------------------------------------
  const auditQuery = z.object({
    entity_type: z.string().max(100).optional(),
    entity_id: uuid.optional(),
    actor_id: z.string().max(255).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  });
  api.get('/audit-logs', read, async (c) => {
    const f = parse(auditQuery, query(c));
    return c.json(
      await many(
        pool,
        `SELECT * FROM audit_logs
          WHERE ($1::text IS NULL OR entity_type = $1) AND ($2::uuid IS NULL OR entity_id = $2)
            AND ($3::text IS NULL OR actor_id = $3)
          ORDER BY created_at DESC, id LIMIT ${f.limit}`,
        [f.entity_type ?? null, f.entity_id ?? null, f.actor_id ?? null],
      ),
    );
  });

  app.route('/api/v1', api);
  return app;
}
