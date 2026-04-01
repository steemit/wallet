import { test, expect } from '@playwright/test';

test.describe('Smoke', () => {
  test('home page loads and shows login form', async ({ page }) => {
    await page.goto('/');
    // LoginForm submit (locale-aware); not "password" — secret field is labeled Private Key.
    await expect(
      page.getByRole('button', { name: /sign in|log in|login|登录|iniciar sesión/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('login page has username and private key inputs', async ({ page }) => {
    await page.goto('/login');
    await expect(
      page.getByRole('textbox', { name: /username|用户|usuario/i }).first()
    ).toBeVisible({ timeout: 15_000 });
    // Label comes from auth.privateKey ("Private Key" / "私钥" / "Clave privada"), not "password".
    await expect(page.locator('#password')).toBeVisible({ timeout: 5_000 });
  });
});
