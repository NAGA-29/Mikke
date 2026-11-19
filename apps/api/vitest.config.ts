import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // すべてのテストが同じDBを共有するため直列実行
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://mikke:mikke@localhost:5432/mikke_test',
    },
  },
});
