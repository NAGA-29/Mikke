import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { createMcpServer } from './server.js';

// stdout は MCP 専用。設定・DB・トークンを例外ログに含めない。
async function main() {
  const config = loadConfig();
  const token = process.env.MIKKE_MCP_TOKEN ?? '';
  delete process.env.MIKKE_MCP_TOKEN;
  const pool = createPool(config.databaseUrl);
  // pool既定の生エラーメッセージ出力をMCPプロセスでは抑止する。
  pool.removeAllListeners('error');
  pool.on('error', () => console.error('mikke MCP: database connection error'));
  try {
    const server = createMcpServer({ pool, config }, token);
    const transport = new StdioServerTransport();
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      await server.close();
      await pool.end();
    };
    server.server.onclose = () => {
      void shutdown();
    };
    process.once('SIGINT', () => {
      void shutdown();
    });
    process.once('SIGTERM', () => {
      void shutdown();
    });
    await server.connect(transport);
  } catch {
    await pool.end();
    throw new Error('startup failed');
  }
}
main().catch(() => {
  console.error('mikke MCP: startup failed; check environment configuration and token');
  process.exitCode = 1;
});
