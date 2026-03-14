import { test, expect } from '@playwright/test';

test.describe('Smoke', () => {
  test('home page loads and shows login form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /sign in|login/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('login page has username and password inputs', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('textbox', { name: /username/i }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/password/i).first()).toBeVisible({ timeout: 5_000 });
  });
});
