import { expect, test } from '@playwright/test';
import { E2E_TOKEN } from '../env.js';

test('API が Web のプロキシ経由で認証付きで応答する', async ({ request }) => {
  const unauth = await request.get('/api/v1/resources');
  expect(unauth.status()).toBe(401);
  const res = await request.get('/api/v1/resources', { headers: { authorization: `Bearer ${E2E_TOKEN}` } });
  expect(res.status()).toBe(200);
  expect(Array.isArray((await res.json()).items)).toBe(true);
});
