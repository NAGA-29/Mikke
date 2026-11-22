import { expect, type Page } from '@playwright/test';
import { E2E_TOKEN, E2E_WRITER_TOKEN } from '../env.js';

export async function login(page: Page, token = E2E_TOKEN) {
  await page.goto('/');
  await page.getByTestId('login-input').fill(token);
  await page.getByTestId('login-button').click();
}

export async function loginOk(page: Page) {
  await login(page);
  await expect(page.getByTestId('nav-resources')).toBeVisible();
}

const auth = { authorization: `Bearer ${E2E_TOKEN}` };

/** テストデータの投入は API で行う（UIの検証対象外の前提条件） */
export async function seedResource(
  request: import('@playwright/test').APIRequestContext,
  body: Record<string, unknown>,
) {
  const res = await request.post('/api/v1/resources', { headers: auth, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

export const unique = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Req = import('@playwright/test').APIRequestContext;
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** API を直接呼ぶ（前提データの投入用）。失敗したらテストを落とす */
export async function api(request: Req, method: 'POST' | 'PUT' | 'PATCH', path: string, data: unknown, as: 'admin' | 'writer' = 'admin') {
  const res = await request.fetch(`/api/v1${path}`, {
    method,
    headers: bearer(as === 'admin' ? E2E_TOKEN : E2E_WRITER_TOKEN),
    data,
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as any };
}
