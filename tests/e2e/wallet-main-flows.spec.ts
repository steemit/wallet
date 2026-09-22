import { test, expect } from '@playwright/test';

/**
 * Wallet main-flow browser tests (review finding K-4).
 *
 * The e2e environment runs the real dev server with NO mocked chain: upstream
 * availability differs between CI (usually no egress) and local runs. Every
 * assertion here is therefore deterministic by construction:
 *   - degraded-path tests intercept `/api/query/*` at the browser level, so
 *     they force the degradation UX regardless of real upstream state;
 *   - shell tests assert only static chrome + i18n text (never
 *     timing-sensitive chain data).
 * CI runs with workers=1; these tests share no state across each other.
 */

test.describe('Wallet main flows', () => {
  test('transfers page renders its shell and zeroed balance rows on the degraded path', async ({
    page,
  }) => {
    // Force the degradation UX deterministically: every upstream query fails
    // at the fetch level (this pins the degraded path end-to-end even on
    // machines that CAN reach api.steemit.com).
    await page.route('**/api/query/**', (route) => route.abort());

    const response = await page.goto('/@alice/transfers');
    // The page itself must answer 200 — degradation is a data state, not an
    // HTTP error.
    expect(response?.status()).toBe(200);

    // Profile banner: the account name paints from the URL even when the
    // profile fetch fails (banner falls back to the raw accountname).
    await expect(page.getByRole('heading', { name: /alice/i })).toBeVisible({
      timeout: 20_000,
    });

    // Wallet sub-nav (locale-aware label).
    await expect(
      page.getByRole('link', { name: /^balances$|^余额$|^saldos$/i })
    ).toBeVisible();

    // Balance rows paint with zeroed values — NOT a crash, NOT an endless
    // skeleton. Row labels are intentionally non-i18n English strings.
    await expect(page.getByText('STEEM POWER', { exact: true })).toBeVisible();
    await expect(page.getByText('STEEM DOLLARS', { exact: true })).toBeVisible();
    await expect(page.getByText('0.000 STEEM', { exact: true }).first()).toBeVisible();
  });

  test('login page shows client-side validation error for a malformed username', async ({
    page,
  }) => {
    await page.goto('/login');

    await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
    // "@@@" passes the native required check but normalizes to the empty
    // string — the client-side validation branch, reached with NO network.
    await page.locator('#username').fill('@@@');
    await page.locator('#password').fill('5J-not-a-real-key');
    // Scope to the form inside <main> — the site header has its own
    // locale-aware "Login" button which is NOT the submit control.
    await page
      .locator('main')
      .getByRole('button', { name: /sign in|log in|login|登录|iniciar sesión/i })
      .first()
      .click();

    await expect(
      page.getByText(
        /username and secret are required|用户名和密钥为必填项|se requieren nombre de usuario y secreto/i
      )
    ).toBeVisible({ timeout: 10_000 });
  });

  test('market page renders its shell and surfaces the degraded data state', async ({ page }) => {
    // Deterministic degraded market data: abort only the market queries; the
    // page shell is static and must still paint around the error.
    await page.route('**/api/query/market*', (route) => route.abort());

    await page.goto('/market');

    // Static shell: page title + the (unauthenticated) sign-in-to-trade
    // notice — both locale-aware, both rendered before/regardless of data.
    await expect(
      page.getByRole('heading', { name: /^market$|^市场$|^mercado$/i })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(
        /sign in with your active key|请使用 active 密钥登录后再下单|inicia sesión con tu clave active/i
      )
    ).toBeVisible();

    // Degraded data state is surfaced as an alert, not a crash or an
    // eternal skeleton (use-market-data sets `error` when the query fails).
    // Scope to the app's error paragraph inside <main> and pin its text:
    // Next.js's #__next_route_announcer__ (outside <main>) also carries
    // role="alert", so an unscoped getByRole('alert') matches 2 elements
    // and trips strict mode. The text is Chromium's TypeError message for
    // an aborted fetch, passed through verbatim by use-market-data
    // (chromium is the only e2e project, so it is deterministic).
    await expect(
      page.locator('main p[role="alert"]', { hasText: 'Failed to fetch' })
    ).toBeVisible({ timeout: 15_000 });
  });
});
