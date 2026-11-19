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

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  // 受理済みリクエストの処理が終わってから DB 接続を閉じる
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
