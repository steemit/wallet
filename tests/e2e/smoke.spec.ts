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

  // Route-level boundary: the [...rest] catch-all throws notFound(), which
  // Next.js serves through the client-recovery shell (empty SSR document +
  // RSC payload), so only a real browser exercise proves the localized
  // boundary actually paints with the site chrome.
  test('unknown route renders the localized not-found boundary', async ({ page }) => {
    const response = await page.goto('/nonexistent/deep');
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { name: /page not found|页面未找到|página no encontrada/i })
    ).toBeVisible({ timeout: 15_000 });
    const home = page.getByRole('link', { name: /back to home|返回首页|volver al inicio/i });
    await expect(home).toBeVisible();
    await expect(home).toHaveAttribute('href', '/');
    // Within the app chrome: the layout header renders around the boundary.
    await expect(page.getByRole('banner')).toBeVisible();
  });
});
