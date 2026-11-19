import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = createApp({ pool, config });

if (config.tokens.length === 0) {
  console.warn('MIKKE_API_TOKENS is empty: every /api request will be rejected (401)');
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`mikke api listening on :${info.port}`);
});

const shutdown = () => {
  server.close();
  void pool.end();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
