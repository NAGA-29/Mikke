import { expect, test } from '@playwright/test';
import { login, loginOk } from './helpers.js';

test.describe('ログイン', () => {
  test('不正なトークンはエラーになり、ログインできない', async ({ page }) => {
    await login(page, 'invalid-token');
    await expect(page.getByTestId('login-error')).toContainText('トークンが正しくありません');
    await expect(page.getByTestId('nav-resources')).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  });

  test('正しいトークンでログインし、ログアウトできる', async ({ page }) => {
    await loginOk(page);
    await expect(page.getByRole('heading', { name: '資産' })).toBeVisible();
    await page.getByTestId('logout').click();
    await expect(page.getByTestId('login-input')).toBeVisible();
  });

  test('トークン表示の切り替え', async ({ page }) => {
    await page.goto('/');
    const input = page.getByTestId('login-input');
    await expect(input).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: '表示' }).click();
    await expect(input).toHaveAttribute('type', 'text');
  });
});
