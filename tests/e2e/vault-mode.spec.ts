/**
 * Vault work mode e2e (A5) — the FIRST real-browser coverage of the vault
 * stack (real IndexedDB, real Web Crypto; the unit suite runs against
 * mocks). CI runs workers=1; locally the dev server is reused.
 *
 * Covered (kickoff A5 acceptance):
 *  - the side-panel Work Mode entry opens the drawer (logged OUT — the mode
 *    is a device preference, not a login feature);
 *  - switching to Vault Mode persists WITHOUT a page reload (window marker
 *    survives + app chrome stays attached);
 *  - an empty vault state offers the three options (create / import /
 *    continue browsing);
 *  - the create flow (name + password -> key-backup confirmation) lands the
 *    vault in the list, LOCKED (creation never auto-unlocks);
 *  - unlock / lock round-trip with the real PBKDF2 path;
 *  - export triggers a real browser download of the five-field backup;
 *  - switching back to PrivateKey Mode keeps working.
 *
 * The vault password below is TEST-ONLY data (fixture discipline) and never
 * touches a real account.
 */
import { test, expect } from '@playwright/test';

const VAULT_NAME = 'E2E Vault';
// ≥14 code points, not on the common-password blocklist, not an account name.
const VAULT_PASSWORD = 'e2e-vault-passphrase-42';

/** Marker proving no navigation happened across an interaction. */
async function setNoReloadMarker(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __vaultE2eNoReload?: string }).__vaultE2eNoReload = 'alive';
  });
}

async function expectNoReload(page: import('@playwright/test').Page) {
  expect(
    await page.evaluate(
      () => (window as unknown as { __vaultE2eNoReload?: string }).__vaultE2eNoReload,
    ),
  ).toBe('alive');
  // The app chrome would be rebuilt by any navigation. CSS locator, not
  // getByRole('banner'): open modal dialogs aria-hide the page content and
  // role queries would stop matching it.
  await expect(page.locator('header')).toBeVisible();
}

async function openWorkModeDrawer(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('side-panel-work-mode').click();
  const drawer = page.getByTestId('work-mode-drawer');
  await expect(drawer).toBeVisible({ timeout: 15_000 });
  return drawer;
}

test.describe('Vault work mode', () => {
  test('switching to Vault Mode persists without a reload and offers the three empty-state options', async ({
    page,
  }) => {
    await page.goto('/');
    await setNoReloadMarker(page);

    const drawer = await openWorkModeDrawer(page);

    // Mode radios are addressed via [data-mode] CSS locators, not getByRole:
    // once the empty-vault dialog (a modal) opens, the drawer subtree goes
    // aria-hidden and role-based queries stop matching the radios.

    // Fresh profile: the persisted default is PrivateKey Mode, marked legacy.
    const privateKeyRadio = drawer.locator('[data-mode="privateKey"]');
    const vaultRadio = drawer.locator('[data-mode="vault"]');
    await expect(privateKeyRadio).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
    await expect(drawer.getByText('Legacy', { exact: true })).toBeVisible();

    await vaultRadio.click();

    // Success switches in place — no navigation, marker + chrome survive.
    await expect(vaultRadio).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
    await expectNoReload(page);

    // Empty vault state: three options.
    const emptyDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'No vaults yet' }),
    });
    await expect(emptyDialog).toBeVisible({ timeout: 15_000 });
    await expect(emptyDialog.getByRole('button', { name: 'Create a new vault' })).toBeVisible();
    await expect(emptyDialog.getByRole('button', { name: 'Import a backup' })).toBeVisible();
    await expect(emptyDialog.getByRole('button', { name: 'Continue browsing' })).toBeVisible();

    // "Continue browsing" closes the dialog; the vault section stays usable.
    await emptyDialog.getByRole('button', { name: 'Continue browsing' }).click();
    await expect(emptyDialog).toBeHidden();
    await expect(drawer.getByText('No vaults yet. Create a vault or import a backup to use Vault Mode.')).toBeVisible();

    // Switch back to PrivateKey — still in place.
    await drawer.locator('[data-mode="privateKey"]').click();
    await expect(privateKeyRadio).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
    await expectNoReload(page);
  });

  test('vault lifecycle: create, confirm backup, unlock, lock, export download', async ({ page }) => {
    await page.goto('/');
    await setNoReloadMarker(page);

    const drawer = await openWorkModeDrawer(page);

    // Enter Vault Mode via the empty dialog's create option. The radio is a
    // CSS locator (role queries lose it once the modal dialog aria-hides the
    // drawer subtree).
    await drawer.locator('[data-mode="vault"]').click();
    const emptyDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'No vaults yet' }),
    });
    await emptyDialog.getByRole('button', { name: 'Create a new vault' }).click({
      timeout: 15_000,
    });

    // Create form (name + password + confirm).
    const createForm = drawer.getByTestId('vault-create-form');
    await expect(createForm).toBeVisible({ timeout: 15_000 });
    await createForm.getByLabel('Vault name').fill(VAULT_NAME);
    await createForm.getByLabel('Vault password', { exact: true }).fill(VAULT_PASSWORD);
    await createForm.getByLabel('Confirm vault password').fill(VAULT_PASSWORD);
    await createForm.getByRole('button', { name: 'Create vault' }).click();

    // Key-backup confirmation dialog (PBKDF2 runs first — generous timeout).
    const confirmDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Back up your vault' }),
    });
    await expect(confirmDialog).toBeVisible({ timeout: 30_000 });
    // Both warning lines are distinct from the checkbox label text.
    await expect(
      confirmDialog.getByText(/cannot be recovered on this device/i),
    ).toBeVisible();
    await expect(confirmDialog.getByText(/blockchain are not affected/i)).toBeVisible();
    // Continue stays disabled until the backup acknowledgment is ticked.
    const continueButton = confirmDialog.getByRole('button', { name: 'Continue', exact: true });
    await expect(continueButton).toBeDisabled();
    await confirmDialog.getByRole('checkbox').check();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await expect(confirmDialog).toBeHidden();

    // The list shows the new vault — created LOCKED (no auto-unlock).
    const row = drawer.getByTestId('vault-row').filter({ hasText: VAULT_NAME });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('Locked', { exact: true })).toBeVisible();

    // Unlock round-trip through the real crypto path.
    await row.getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('menuitem', { name: 'Unlock' }).click();
    const unlockDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Unlock vault' }),
    });
    await expect(unlockDialog).toBeVisible({ timeout: 15_000 });
    await unlockDialog.getByLabel('Vault password').fill(VAULT_PASSWORD);
    await unlockDialog.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(row.getByText('Unlocked', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(unlockDialog).toBeHidden();

    await row.getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('menuitem', { name: 'Lock' }).click();
    await expect(row.getByText('Locked', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Export triggers a real browser download of the five-field backup.
    await row.getByRole('button', { name: 'Manage' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Export backup' }).click(),
    ]);
    expect(download.suggestedFilename()).toContain('E2E_Vault');
    expect(download.suggestedFilename()).toMatch(/^steem-wallet-vault-/);

    // Switch back to PrivateKey Mode to close the loop.
    const privateKeyRadio = drawer.locator('[data-mode="privateKey"]');
    await privateKeyRadio.click();
    await expect(privateKeyRadio).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
    await expectNoReload(page);
  });
});
