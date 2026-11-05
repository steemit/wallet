import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import vectors from '../fixtures/vault-development-test-vectors.json';

/**
 * Per-key vault (R1–R3) real-browser coverage — handoff §5 step 5.
 *
 * Runs against the real dev server with real IndexedDB + real Web Crypto
 * (PBKDF2 600k), exactly like vault-mode.spec.ts; every chain-dependent
 * branch is made deterministic by intercepting `/api/query/accounts` with
 * controlled responses (the recommended approach: the fixture WIFs belong to
 * accounts that do not exist on chain, and real-RPC availability differs per
 * machine). All other `/api/query/*` traffic is aborted where a page would
 * otherwise hit the network, so no test ever depends on upstream egress.
 *
 * Covered here (real browser):
 *  - main journey: create vault -> add fixture WIF + note (chain-verified
 *    green) -> browse the directory LOCKED (no unlock, no password beyond the
 *    per-key encryption) -> identity login through the two selects -> header
 *    session -> directory-change refresh when the Work Mode modal closes;
 *  - no `/api/auth/challenge`, `/api/auth/login` or `/api/auth/logout`
 *    request during the whole vault identity flow (asserted via page.on);
 *  - add-key verdicts: matched (green), authority-differs (amber), not-on-
 *    chain (amber, fail-OPEN storage with warning) and the fail-CLOSED
 *    `VAULT_AUTHORITY_UNAVAILABLE` path, recovered by retry;
 *  - same-role multiple keys, duplicate (account, role, publicKey) idempotent
 *    banner, removal located by the account+role+IV pointer;
 *  - multi-vault / multi-account login page, rapid vault switching with no
 *    cross-vault account leakage, identity submitted from the second vault;
 *  - login-page empty states (no vault / empty vault) and the PrivateKey
 *    regression (switching the device back renders the classic form);
 *  - forms never overflow horizontally; secondary dialogs are z-60 and
 *    interactable on top of the Work Mode modal.
 *
 * NOT e2e'd (no signing UI exists for vault sessions until A6 — the vault
 * identity carries no keys, so there is nothing real to drive): decrypt-only-
 * the-selected-key and pre-broadcast scrubbing. Both stay pinned by unit
 * tests (tests/unit/vault-signer.test.ts: IV-selected-key contract, scrubbed
 * request fields, byte-identical records). This spec does not fake them.
 *
 * Fixture discipline: the WIFs, public keys, vault password and account
 * names below come from tests/fixtures/vault-development-test-vectors.json
 * (TEST-ONLY data — never real accounts). The synthetic chain authorities
 * reuse the fixture public keys so the verdicts are deterministic.
 */

const VAULT_PASSWORD = vectors.vault.password;

function fixtureKey(role: 'posting' | 'active') {
  const key = vectors.vault.keys.find((entry) => entry.role === role);
  if (!key) throw new Error(`fixture is missing the ${role} key`);
  return key;
}

// ---------------------------------------------------------------------------
// Controlled /api/query/accounts responses
// ---------------------------------------------------------------------------

/** Public keys that are on no fixture and no synthetic authority. */
const OTHER_AUTHORITY_KEY = 'STM8OtherAuthorityKeyNotInAnyFixture0000000000000';
const OTHER_MEMO_KEY = 'STM8OtherMemoKeyNotInAnyFixture0000000000000000000000';

function authority(weightThreshold: number, keys: ReadonlyArray<readonly [string, number]> = []) {
  return {
    weight_threshold: weightThreshold,
    key_auths: keys.map(([publicKey, weight]) => [publicKey, weight]),
    account_auths: [],
  };
}

interface ChainKeySpec {
  owner?: ReadonlyArray<readonly [string, number]>;
  active?: ReadonlyArray<readonly [string, number]>;
  posting?: ReadonlyArray<readonly [string, number]>;
  memoKey?: string;
}

function chainAccount(name: string, spec: ChainKeySpec = {}) {
  return {
    name,
    owner: authority(1, spec.owner ?? [[OTHER_AUTHORITY_KEY, 1]]),
    active: authority(1, spec.active ?? [[OTHER_AUTHORITY_KEY, 1]]),
    posting: authority(1, spec.posting ?? [[OTHER_AUTHORITY_KEY, 1]]),
    memo_key: spec.memoKey ?? OTHER_MEMO_KEY,
  };
}

/**
 * Serve controlled account data for /api/query/accounts?names=... . Register
 * AFTER any catch-all query route glob: Playwright consults the most recently
 * registered matching route first, so this handler wins.
 */
async function fulfillAccountsRoute(
  page: Page,
  accounts: Record<string, ReturnType<typeof chainAccount>>,
) {
  await page.route('**/api/query/accounts*', (route) => {
    const names = (new URL(route.request().url()).searchParams.get('names') ?? '')
      .split(',')
      .filter(Boolean)
      .map((name) => name.toLowerCase());
    const found = names
      .map((name) => accounts[name])
      .filter((account) => account !== undefined);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, accounts: found }),
    });
  });
}

/** Abort every query route (noise floor for pages we do not assert data on). */
async function abortAllQueries(page: Page) {
  await page.route('**/api/query/**', (route) => route.abort());
}

// ---------------------------------------------------------------------------
// Work Mode modal helpers
// ---------------------------------------------------------------------------

async function openWorkModeModal(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('side-panel-work-mode').click();
  const modal = page.getByTestId('work-mode-modal');
  await expect(modal).toBeVisible({ timeout: 15_000 });
  return modal;
}

async function closeWorkModeModal(modal: Locator) {
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(modal).toBeHidden();
}

async function switchToVaultMode(modal: Locator) {
  const vaultRadio = modal.locator('[data-mode="vault"]');
  await vaultRadio.click();
  await expect(vaultRadio).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
}

/** The three-option dialog that pops when Vault Mode is entered with no vaults. */
function emptyVaultsDialog(page: Page) {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'No vaults yet' }),
  });
}

/** Post-create backup acknowledgment: dismiss-proof until ticked (z-60). */
async function ackBackupConfirmation(page: Page) {
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Back up your vault' }),
  });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toHaveCSS('z-index', '60');
  const continueButton = dialog.getByRole('button', { name: 'Continue', exact: true });
  await expect(continueButton).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(dialog).toBeHidden();
}

/**
 * Create a vault through the panel. `viaEmptyDialog` picks the entry point:
 * on a device with zero vaults the auto-opened empty dialog must be used (it
 * overlays the list); otherwise the list header's Create button.
 */
async function createVault(
  page: Page,
  modal: Locator,
  name: string,
  viaEmptyDialog: boolean,
): Promise<Locator> {
  if (viaEmptyDialog) {
    await emptyVaultsDialog(page)
      .getByRole('button', { name: 'Create a new vault' })
      .click({ timeout: 15_000 });
  } else {
    await modal.getByRole('button', { name: 'Create vault', exact: true }).click();
  }
  const form = modal.getByTestId('vault-create-form');
  await expect(form).toBeVisible({ timeout: 15_000 });
  await expect(
    await form.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await form.getByLabel('Vault name').fill(name);
  await form.getByLabel('Vault password', { exact: true }).fill(VAULT_PASSWORD);
  await form.getByLabel('Confirm vault password').fill(VAULT_PASSWORD);
  await form.getByRole('button', { name: 'Create vault' }).click();

  await ackBackupConfirmation(page);

  const row = modal.getByTestId('vault-row').filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 15_000 });
  // Creation never auto-unlocks (per-key era: there is nothing to unlock).
  await expect(row.getByText('Locked', { exact: true })).toBeVisible();
  return row;
}

async function openKeyManager(page: Page, modal: Locator, vaultName: string) {
  const row = modal.getByTestId('vault-row').filter({ hasText: vaultName });
  await row.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage keys' }).click();
  const view = page.getByTestId('vault-key-manager');
  await expect(view).toBeVisible({ timeout: 15_000 });
  return view;
}

// ---------------------------------------------------------------------------
// Add-key dialog helpers
// ---------------------------------------------------------------------------

function addKeyForm(page: Page): Locator {
  return page.getByTestId('vault-add-key-form');
}

async function openAddKeyDialog(view: Locator) {
  await view.getByRole('button', { name: 'Add key', exact: true }).click();
}

interface AddKeyEntry {
  account: string;
  role?: 'owner' | 'active' | 'posting' | 'memo';
  wif: string;
  note: string;
}

async function fillAddKeyForm(form: Locator, entry: AddKeyEntry) {
  await form.getByLabel('Account name').fill(entry.account);
  if (entry.role !== undefined && entry.role !== 'posting') {
    await form.locator('#vault-add-key-role').selectOption(entry.role);
  }
  await form.getByLabel('Private key (WIF)').fill(entry.wif);
  await form.getByLabel('Note (optional)').fill(entry.note);
  await form
    .getByLabel('Vault password (used only to encrypt this key)')
    .fill(VAULT_PASSWORD);
}

/**
 * The full add-key happy path: open the dialog, fill, verify on chain, assert
 * the verdict copy, confirm storage, assert the panel banner. The nested
 * dialog must sit at z-60 above the Work Mode modal and stay interactable
 * (clicking through it IS the not-obscured assertion), and neither the form
 * nor the page may overflow horizontally.
 */
async function addKeyThroughDialog(
  page: Page,
  view: Locator,
  entry: AddKeyEntry,
  expectedVerdict: RegExp,
  expectedBanner: RegExp,
) {
  await openAddKeyDialog(view);
  const form = addKeyForm(page);
  await expect(form).toBeVisible({ timeout: 15_000 });

  // Secondary dialog contract: z-60, interactable, no horizontal overflow.
  const dialog = page
    .locator('[data-slot="dialog-content"]')
    .filter({ has: form });
  await expect(dialog).toHaveCSS('z-index', '60');
  await expectNoHorizontalOverflow(page, '[data-testid="vault-add-key-form"]');

  await fillAddKeyForm(form, entry);

  // Phase 1: local WIF validation + one batched fresh accounts query.
  await form.getByTestId('vault-add-key-primary').click();
  const verdict = form.getByTestId('vault-add-key-verification');
  await expect(verdict).toBeVisible({ timeout: 20_000 });
  await expect(verdict).toContainText(expectedVerdict);

  // Phase 2: explicit confirm -> per-key encryption (real PBKDF2) -> close.
  await form.getByTestId('vault-add-key-primary').click();
  await expect(form).toBeHidden({ timeout: 30_000 });
  await expect(view.getByText(expectedBanner)).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Generic UI checks
// ---------------------------------------------------------------------------

/**
 * Neither the page, the scoped element, nor its owning dialog box may scroll
 * horizontally.
 *
 * Measurement note: the shared `DialogFooter` (src/components/ui/dialog.tsx)
 * is a deliberate FULL-BLEED band — `-mx-4` stretches it past the dialog's
 * content padding to the dialog edges. A naive `scrollWidth > clientWidth`
 * on a form containing it reports that design, not an actual overflow (the
 * dialog box itself does not scroll). The footer subtree is therefore
 * excluded from the inner-element check and validated instead against the
 * DIALOG box, where it must fit exactly; every other descendant must stay
 * inside the scoped element on both axes.
 */
async function expectNoHorizontalOverflow(page: Page, selector: string) {
  const offenders = await page.evaluate(
    (s) => {
      const bad: string[] = [];
      const root = document.documentElement;
      if (root.scrollWidth > root.clientWidth) bad.push('documentElement');
      const el = document.querySelector(s);
      if (el === null) {
        bad.push(`${s} (missing)`);
        return bad;
      }
      const dialog = el.closest('[data-slot="dialog-content"]');
      const scopes = [el, ...(dialog !== null ? [dialog] : [])];
      for (const scope of scopes) {
        const box = scope.getBoundingClientRect();
        const isDialogScope = scope === dialog;
        const nodes = [scope, ...scope.querySelectorAll<HTMLElement>('*')];
        for (const node of nodes) {
          if (
            !isDialogScope &&
            node.closest('[data-slot="dialog-footer"]') !== null
          ) {
            continue;
          }
          // Native select options live in the closed popup, not the layout:
          // Chromium reports zero-area rects at the origin for them.
          if (node.tagName === 'OPTION' || node.tagName === 'OPTGROUP') continue;
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.left < box.left - 0.5 || rect.right > box.right + 0.5) {
            bad.push(
              `${s} (${node.tagName.toLowerCase()} outside its ${isDialogScope ? 'dialog' : 'scope'})`,
            );
            break;
          }
        }
      }
      return bad;
    },
    selector,
  );
  expect(offenders, `unexpected horizontal overflow: ${offenders.join(', ')}`).toEqual([]);
}

/** All option values of a select, polled (options load asynchronously). */
async function selectValues(select: Locator): Promise<string[]> {
  return select
    .locator('option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
}

/** Record every request to the server-side auth endpoints (must stay empty). */
function trackAuthEndpoints(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/\/api\/auth\/(challenge|login|logout)/.test(url)) urls.push(url);
  });
  return urls;
}

test.describe('Vault per-key hierarchy (R1-R3)', () => {
  test.setTimeout(150_000);

  test('main journey: create, add fixture WIF with note, browse locked, identity login with no auth endpoints, directory refresh', async ({
    page,
  }) => {
    const postingKey = fixtureKey('posting');
    const activeKey = fixtureKey('active');
    // Catch-all first (lowest priority), then the controlled accounts route.
    await abortAllQueries(page);
    await fulfillAccountsRoute(page, {
      alice: chainAccount('alice', { posting: [[postingKey.publicKey, 1]] }),
      bob: chainAccount('bob', { posting: [[activeKey.publicKey, 1]] }),
    });
    const authEndpoints = trackAuthEndpoints(page);

    await page.goto('/');
    const modal = await openWorkModeModal(page);
    await switchToVaultMode(modal);
    const row = await createVault(page, modal, 'Main Vault', true);

    // Add the fixture posting WIF with a note — chain-verified green path.
    const view = await openKeyManager(page, modal, 'Main Vault');
    await addKeyThroughDialog(
      page,
      view,
      { account: 'alice', wif: postingKey.privateKey, note: 'desktop posting key' },
      /Verified: this key matches the on-chain Posting authority \(weight 1 of 1\)/,
      /Key added to the vault\./,
    );

    // Locked-state browsing: the whole directory renders with NO unlock —
    // the only password ever typed was the per-key encryption password.
    await expectNoHorizontalOverflow(page, '[data-testid="vault-key-manager"]');
    const aliceGroup = view.getByTestId('vault-key-account').filter({ hasText: 'alice' });
    await expect(aliceGroup.getByText('Owner 0 · Active 0 · Posting 1 · Memo 0')).toBeVisible();
    await expect(
      aliceGroup.getByTestId('vault-key-row').filter({ hasText: 'desktop posting key' }),
    ).toBeVisible();
    await view.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(row.getByText('Locked', { exact: true })).toBeVisible();

    await closeWorkModeModal(modal);

    // Login page: identity selection through the two selects.
    await page.goto('/login');
    const vaultSelect = page.getByTestId('vault-login-vault-select');
    await expect(vaultSelect).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page, '[data-testid="vault-login-form"]');
    await expect.poll(() => selectValues(vaultSelect)).toEqual(['Main Vault']);

    // Directory-change refresh: manage from the login page (the form stays
    // mounted under the modal), add a second account, close -> the list
    // re-reads on VAULT_WORK_MODE_CLOSED_EVENT without a reload.
    const loginModal = await openWorkModeModal(page);
    const viewAgain = await openKeyManager(page, loginModal, 'Main Vault');
    await addKeyThroughDialog(
      page,
      viewAgain,
      { account: 'bob', wif: activeKey.privateKey, note: 'laptop posting slot' },
      /Verified: this key matches the on-chain Posting authority \(weight 1 of 1\)/,
      /Key added to the vault\./,
    );
    await closeWorkModeModal(loginModal);

    const accountSelect = page.getByTestId('vault-login-account-select');
    await expect(accountSelect).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => selectValues(accountSelect)).toEqual(['', 'alice', 'bob']);

    // Submit the identity: local selection only. Drop the controlled accounts
    // route first so the transfers page degrades deterministically (the
    // catch-all abort takes over — the proven shell path).
    await page.unroute('**/api/query/accounts*');
    await accountSelect.selectOption('alice');
    await page.getByTestId('vault-login-submit').click();

    await expect(page).toHaveURL(/\/@alice\/transfers$/, { timeout: 15_000 });
    const avatarTrigger = page.locator('header button.rounded-full');
    await expect(avatarTrigger).toBeVisible();
    await avatarTrigger.click();
    await expect(
      page.getByRole('menuitem').filter({ hasText: 'Wallet' }),
    ).toHaveAttribute('href', '/@alice/transfers');

    // The whole vault flow is client-side: no challenge, login or logout.
    expect(authEndpoints).toEqual([]);
  });

  test('login page empty states, directory refresh on modal close, PrivateKey regression', async ({
    page,
  }) => {
    const postingKey = fixtureKey('posting');
    await fulfillAccountsRoute(page, {
      alice: chainAccount('alice', { posting: [[postingKey.publicKey, 1]] }),
    });

    await page.goto('/');
    let modal = await openWorkModeModal(page);
    await switchToVaultMode(modal);
    // Dismiss the empty-state prompt; keep zero vaults for the login check.
    const emptyDialog = emptyVaultsDialog(page);
    await expect(emptyDialog).toBeVisible({ timeout: 15_000 });
    await emptyDialog.getByRole('button', { name: 'Continue browsing' }).click();
    await expect(emptyDialog).toBeHidden();
    await closeWorkModeModal(modal);

    // Empty state #1: no vault on the device.
    await page.goto('/login');
    const noVaults = page.getByTestId('vault-login-no-vaults');
    await expect(noVaults).toBeVisible({ timeout: 15_000 });
    await expect(noVaults.getByText('No vault on this device yet')).toBeVisible();
    await expectNoHorizontalOverflow(page, '[data-testid="vault-login-no-vaults"]');
    await expect(page.getByTestId('vault-login-account-select')).toHaveCount(0);

    // The entry button opens the Work Mode modal (the open event path).
    await noVaults.getByRole('button', { name: 'Open vault management' }).click();
    modal = page.getByTestId('work-mode-modal');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await createVault(page, modal, 'Solo Vault', true);
    await closeWorkModeModal(modal);

    // Empty state #2: vault exists but holds no keys (directory refresh:
    // no-vault -> created vault surfaced without leaving the page).
    const emptyVault = page.getByTestId('vault-login-empty-vault');
    await expect(emptyVault).toBeVisible({ timeout: 15_000 });
    await expect(emptyVault.getByText('This vault holds no accounts yet')).toBeVisible();
    await expectNoHorizontalOverflow(page, '[data-testid="vault-login-empty-vault"]');

    // Directory refresh: empty vault -> keyed vault through in-modal
    // management, again re-read on modal close.
    await emptyVault.getByRole('button', { name: 'Manage keys' }).click();
    modal = page.getByTestId('work-mode-modal');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    const view = await openKeyManager(page, modal, 'Solo Vault');
    await addKeyThroughDialog(
      page,
      view,
      { account: 'alice', wif: postingKey.privateKey, note: 'first key' },
      /Verified: this key matches the on-chain Posting authority \(weight 1 of 1\)/,
      /Key added to the vault\./,
    );
    await closeWorkModeModal(modal);

    const accountSelect = page.getByTestId('vault-login-account-select');
    await expect(accountSelect).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => selectValues(accountSelect)).toEqual(['', 'alice']);

    // PrivateKey regression: switch the device back — the login page must
    // render the classic username/private-key form again (no vault surfaces).
    modal = await openWorkModeModal(page);
    const privateKeyRadio = modal.locator('[data-mode="privateKey"]');
    await privateKeyRadio.click();
    await expect(privateKeyRadio).toHaveAttribute('aria-checked', 'true', {
      timeout: 15_000,
    });
    await closeWorkModeModal(modal);
    await expect(page.getByTestId('vault-login-form')).toHaveCount(0);
    await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#password')).toBeVisible();
  });

  test('verdict matrix: authority-differs and not-on-chain warnings still store; duplicate add is idempotent; removal by IV pointer', async ({
    page,
  }) => {
    const postingKey = fixtureKey('posting');
    const activeKey = fixtureKey('active');
    await fulfillAccountsRoute(page, {
      // alice: posting authority holds the posting fixture key, active
      // authority holds the active fixture key (for the differs verdict).
      alice: chainAccount('alice', {
        posting: [[postingKey.publicKey, 1]],
        active: [[activeKey.publicKey, 1]],
      }),
      // bob: no fixture key anywhere -> not-on-chain verdict.
      bob: chainAccount('bob'),
    });

    await page.goto('/');
    const modal = await openWorkModeModal(page);
    await switchToVaultMode(modal);
    await createVault(page, modal, 'Main Vault', true);
    const view = await openKeyManager(page, modal, 'Main Vault');

    // Key #1: green verified posting key.
    await addKeyThroughDialog(
      page,
      view,
      { account: 'alice', wif: postingKey.privateKey, note: 'desktop posting key' },
      /Verified: this key matches the on-chain Posting authority \(weight 1 of 1\)/,
      /Key added to the vault\./,
    );

    // Key #2: SAME account, SAME role, different fixture WIF — the chain
    // places it on the active authority, so the verdict warns
    // authority-differs while the key is stored under the selected role.
    await addKeyThroughDialog(
      page,
      view,
      { account: 'alice', role: 'posting', wif: activeKey.privateKey, note: 'second posting slot' },
      /matches the account's on-chain Active key, not the selected role \(Posting\)/,
      /Key added to the vault\./,
    );

    // Key #3: not on chain at all — fail-OPEN storage with an explicit
    // warning (2026-11-05 ruling: the vault is storage, not proof of
    // authority).
    await addKeyThroughDialog(
      page,
      view,
      { account: 'bob', wif: postingKey.privateKey, note: 'cold storage key' },
      /not part of the account's on-chain authorities/,
      /Key added to the vault\./,
    );

    // Directory: two posting keys for alice (same-role multi-key), one for bob.
    const aliceGroup = view.getByTestId('vault-key-account').filter({ hasText: 'alice' });
    const bobGroup = view.getByTestId('vault-key-account').filter({ hasText: 'bob' });
    await expect(aliceGroup.getByText('Owner 0 · Active 0 · Posting 2 · Memo 0')).toBeVisible();
    await expect(bobGroup.getByText('Owner 0 · Active 0 · Posting 1 · Memo 0')).toBeVisible();

    // Duplicate (account, role, publicKey): the service's no-op is detected
    // through the unchanged public directory — idempotent banner, count stays.
    await addKeyThroughDialog(
      page,
      view,
      { account: 'alice', wif: postingKey.privateKey, note: 'desktop posting key' },
      /Verified: this key matches the on-chain Posting authority \(weight 1 of 1\)/,
      /This key is already stored for that account and role — nothing was added\./,
    );
    await expect(aliceGroup.getByText('Owner 0 · Active 0 · Posting 2 · Memo 0')).toBeVisible();

    // Removal: located by account + role + IV (the row), explicit confirm
    // dialog at z-60, no vault password involved.
    const secondSlotRow = aliceGroup
      .getByTestId('vault-key-row')
      .filter({ hasText: 'second posting slot' });
    await secondSlotRow.getByRole('button', { name: 'Remove', exact: true }).click();
    const removeDialog = page.getByTestId('vault-remove-key-dialog');
    await expect(removeDialog).toBeVisible({ timeout: 15_000 });
    await expect(removeDialog).toHaveCSS('z-index', '60');
    await expect(removeDialog).toContainText('Posting key for alice');
    await expectNoHorizontalOverflow(page, '[data-testid="vault-remove-key-dialog"]');
    await removeDialog.getByRole('button', { name: 'Remove key', exact: true }).click();
    await expect(removeDialog).toBeHidden({ timeout: 15_000 });
    await expect(view.getByText(/Key removed from the vault\./)).toBeVisible();

    // The other alice key survives; counts settle back.
    await expect(secondSlotRow).toHaveCount(0);
    await expect(aliceGroup.getByText('Owner 0 · Active 0 · Posting 1 · Memo 0')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      aliceGroup.getByTestId('vault-key-row').filter({ hasText: 'desktop posting key' }),
    ).toBeVisible();
    await expect(bobGroup.getByText('Owner 0 · Active 0 · Posting 1 · Memo 0')).toBeVisible();
  });

  test('on-chain verification fails closed when account data is unavailable, then recovers on retry', async ({
    page,
  }) => {
    const postingKey = fixtureKey('posting');
    const abortAccounts = (route: Route) => route.abort();
    await page.route('**/api/query/accounts*', abortAccounts);

    await page.goto('/');
    const modal = await openWorkModeModal(page);
    await switchToVaultMode(modal);
    await createVault(page, modal, 'Main Vault', true);
    const view = await openKeyManager(page, modal, 'Main Vault');

    // Fill the add-key form and verify while the accounts query fails.
    await openAddKeyDialog(view);
    const form = addKeyForm(page);
    await expect(form).toBeVisible({ timeout: 15_000 });
    await fillAddKeyForm(form, {
      account: 'alice',
      wif: postingKey.privateKey,
      note: 'offline add',
    });
    await form.getByTestId('vault-add-key-primary').click();

    // Fail-closed: mapped VAULT_AUTHORITY_UNAVAILABLE copy, no verdict box,
    // nothing stored — and the form stays usable for a retry.
    await expect(form.getByRole('alert')).toContainText(
      'On-chain account data is unavailable, so the signing authority cannot be verified right now',
      { timeout: 15_000 },
    );
    await expect(form.getByTestId('vault-add-key-verification')).toHaveCount(0);
    await expect(form.getByTestId('vault-add-key-primary')).toBeEnabled();

    // Recovery: replace the failing route with a controlled green response
    // and verify again — same form, no reload.
    await page.unroute('**/api/query/accounts*', abortAccounts);
    await fulfillAccountsRoute(page, {
      alice: chainAccount('alice', { posting: [[postingKey.publicKey, 1]] }),
    });
    await form.getByTestId('vault-add-key-primary').click();
    const verdict = form.getByTestId('vault-add-key-verification');
    await expect(verdict).toBeVisible({ timeout: 15_000 });
    await expect(verdict).toContainText(
      /Verified: this key matches the on-chain Posting authority \(weight 1 of 1\)/,
    );

    await form.getByTestId('vault-add-key-primary').click();
    await expect(form).toBeHidden({ timeout: 30_000 });
    await expect(view.getByText(/Key added to the vault\./)).toBeVisible();
  });

  test('multi-vault login page: rapid vault switching never leaks accounts across vaults', async ({
    page,
  }) => {
    const postingKey = fixtureKey('posting');
    const activeKey = fixtureKey('active');
    await abortAllQueries(page);
    await fulfillAccountsRoute(page, {
      alice: chainAccount('alice', { posting: [[postingKey.publicKey, 1]] }),
      bob: chainAccount('bob', { active: [[activeKey.publicKey, 1]] }),
    });
    const authEndpoints = trackAuthEndpoints(page);

    await page.goto('/');
    const modal = await openWorkModeModal(page);
    await switchToVaultMode(modal);
    await createVault(page, modal, 'Main Vault', true);
    const mainView = await openKeyManager(page, modal, 'Main Vault');
    await addKeyThroughDialog(
      page,
      mainView,
      { account: 'alice', wif: postingKey.privateKey, note: 'desktop posting key' },
      /Verified: this key matches the on-chain Posting authority \(weight 1 of 1\)/,
      /Key added to the vault\./,
    );
    await mainView.getByRole('button', { name: 'Back', exact: true }).click();

    // Second vault (list entry point — no empty dialog with a vault present).
    await createVault(page, modal, 'Second Vault', false);
    const secondView = await openKeyManager(page, modal, 'Second Vault');
    await addKeyThroughDialog(
      page,
      secondView,
      { account: 'bob', role: 'active', wif: activeKey.privateKey, note: 'trezor active key' },
      /Verified: this key matches the on-chain Active authority \(weight 1 of 1\)/,
      /Key added to the vault\./,
    );
    await closeWorkModeModal(modal);

    await page.goto('/login');
    const vaultSelect = page.getByTestId('vault-login-vault-select');
    await expect(vaultSelect).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => selectValues(vaultSelect)).toEqual(['Main Vault', 'Second Vault']);

    // Rapid switching: the account directory must always match the CURRENT
    // vault — a stale directory load may never land (sequence guard).
    const accountSelect = page.getByTestId('vault-login-account-select');
    await vaultSelect.selectOption('Second Vault');
    await vaultSelect.selectOption('Main Vault');
    await vaultSelect.selectOption('Second Vault');
    await expect.poll(() => selectValues(accountSelect)).toEqual(['', 'bob']);
    await vaultSelect.selectOption('Main Vault');
    await expect.poll(() => selectValues(accountSelect)).toEqual(['', 'alice']);
    await vaultSelect.selectOption('Second Vault');
    await expect.poll(() => selectValues(accountSelect)).toEqual(['', 'bob']);

    // Identity submitted from the SECOND vault: the session account is bob.
    await page.unroute('**/api/query/accounts*');
    await accountSelect.selectOption('bob');
    await page.getByTestId('vault-login-submit').click();
    await expect(page).toHaveURL(/\/@bob\/transfers$/, { timeout: 15_000 });
    const avatarTrigger = page.locator('header button.rounded-full');
    await expect(avatarTrigger).toBeVisible();
    await avatarTrigger.click();
    await expect(
      page.getByRole('menuitem').filter({ hasText: 'Wallet' }),
    ).toHaveAttribute('href', '/@bob/transfers');
    expect(authEndpoints).toEqual([]);
  });
});
