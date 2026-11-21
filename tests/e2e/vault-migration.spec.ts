import { test, expect, type Locator, type Page } from '@playwright/test';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { steem } from '@steemit/steem-js';
// The REAL production localStorage key names (alias-free leaf module — the
// same constants lib/auth/browser-storage.ts uses), so the seeding writes
// exactly what the app reads.
import {
  REMEMBERED_POSTING_KEY_KEY,
  REMEMBERED_USERNAME_KEY,
} from '../../src/lib/auth/browser-storage-keys';

/**
 * A6-T5 plaintext migration — real-browser coverage of the verified-readback
 * flow that moves the device-remembered posting key from localStorage into
 * the encrypted vault and deletes the plaintext ONLY after the gate passes.
 *
 * Real IndexedDB + real Web Crypto (PBKDF2 600k), real localStorage seeded
 * through the production key constants; chain-dependent branches are made
 * deterministic by intercepting /api/query/accounts (fixture WIFs belong to
 * accounts that do not exist on chain).
 *
 * Covered:
 *  - happy path: seed the remembered pair -> the key manager offers the
 *    migration ONLY then -> confirmation copy -> vault password -> on-chain
 *    verdict (intercepted) -> "Migrate now" -> success banner; the public
 *    directory shows the migrated key; the plaintext is REMOVED while the
 *    remembered USERNAME stays;
 *  - a vault identity session SIGNS with the migrated key (claim rewards at
 *    the posting floor through the per-key password dialog) — proof the
 *    ciphertext that replaced the plaintext actually works;
 *  - failure paths: wrong vault password -> mapped error, plaintext intact;
 *    cancel after Back -> plaintext intact; retry then succeeds (the
 *    deletion gate never fired on the failures);
 *  - red line "switch back to privateKey": after migration the classic login
 *    renders (username prefilled from the KEPT remembered username), a WIF
 *    login succeeds through the intercepted challenge/login endpoints.
 *
 * Fixture discipline: WIF/public keys/password come from the shared
 * vault-development-test-vectors.json (TEST-ONLY data).
 */

const VAULT_PASSWORD = vectors.vault.password;

function fixtureKey(role: 'posting' | 'active') {
  const key = vectors.vault.keys.find((entry) => entry.role === role);
  if (!key) throw new Error(`fixture is missing the ${role} key`);
  return key;
}

/** Mirror of the UI truncation. */
function shortPublicKey(publicKey: string): string {
  return publicKey.length <= 12
    ? publicKey
    : `${publicKey.slice(0, 7)}…${publicKey.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Real localStorage seeding (production key constants)
// ---------------------------------------------------------------------------

/**
 * Register a SELF-DISARMING init script that seeds the remembered pair ONCE
 * per tab (review r2 N1): a plain addInitScript re-runs on every navigation
 * and would re-seed localStorage AFTER the migration deleted the plaintext,
 * making every retention assertion meaningless — and a per-document window
 * property dies with the document, so it disarms nothing across navigations
 * (the r1 attempt's bug). sessionStorage is the right flag store: per-origin
 * AND per-tab, it survives same-tab navigations. The first run seeds both
 * localStorage keys and sets the flag; every later navigation in the same
 * tab sees the flag and skips — so "plaintext gone / username kept"
 * assertions after a migration observe the app's own writes, not re-seeds.
 */
const E2E_SEED_FLAG = 'wallet:e2e-migration-seeded-once';
async function seedRememberedPair(page: Page, account: string, wif: string) {
  await page.addInitScript(
    ({ postingKeyKey, usernameKey, accountName, postingWif, flag }) => {
      try {
        if (window.sessionStorage.getItem(flag) === '1') return;
        window.sessionStorage.setItem(flag, '1');
      } catch {
        // sessionStorage unavailable (never in this app's browsers) — seed
        // anyway rather than failing the whole test setup.
      }
      window.localStorage.setItem(postingKeyKey, postingWif);
      window.localStorage.setItem(usernameKey, accountName);
    },
    {
      postingKeyKey: REMEMBERED_POSTING_KEY_KEY,
      usernameKey: REMEMBERED_USERNAME_KEY,
      accountName: account,
      postingWif: wif,
      flag: E2E_SEED_FLAG,
    },
  );
}

async function rememberedState(page: Page) {
  return page.evaluate(
    ({ postingKeyKey, usernameKey }) => ({
      postingKey: window.localStorage.getItem(postingKeyKey),
      username: window.localStorage.getItem(usernameKey),
    }),
    { postingKeyKey: REMEMBERED_POSTING_KEY_KEY, usernameKey: REMEMBERED_USERNAME_KEY },
  );
}

// ---------------------------------------------------------------------------
// Controlled chain data (mirror of the other vault specs)
// ---------------------------------------------------------------------------

const OTHER_AUTHORITY_KEY = 'STM8OtherAuthorityKeyNotInAnyFixture0000000000000';
const OTHER_MEMO_KEY = 'STM8OtherMemoKeyNotInAnyFixture0000000000000000000000';

function authority(weightThreshold: number, keys: ReadonlyArray<readonly [string, number]> = []) {
  return {
    weight_threshold: weightThreshold,
    key_auths: keys.map(([publicKey, weight]) => [publicKey, weight]),
    account_auths: [],
  };
}

function chainAccount(
  name: string,
  spec: {
    posting?: ReadonlyArray<readonly [string, number]>;
    active?: ReadonlyArray<readonly [string, number]>;
    rewards?: {
      reward_steem_balance: string;
      reward_sbd_balance: string;
      reward_vesting_steem: string;
      reward_vesting_balance: string;
    };
  } = {},
) {
  return {
    name,
    owner: authority(1, [[OTHER_AUTHORITY_KEY, 1]]),
    active: authority(1, spec.active ?? [[OTHER_AUTHORITY_KEY, 1]]),
    posting: authority(1, spec.posting ?? [[OTHER_AUTHORITY_KEY, 1]]),
    memo_key: OTHER_MEMO_KEY,
    balance: '10.000 STEEM',
    sbd_balance: '0.000 SBD',
    savings_balance: '0.000 STEEM',
    savings_sbd_balance: '0.000 SBD',
    ...(spec.rewards ?? {}),
  };
}

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

function futureExpiration(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 19);
}

async function fulfillTransactionHeader(page: Page) {
  await page.route('**/api/query/transaction-header', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        ref_block_num: 12345,
        ref_block_prefix: 6789012,
        expiration: futureExpiration(),
      }),
    }),
  );
}

const GLOBAL_PROPS = {
  total_vesting_shares: '200000000.000000 VESTS',
  total_vesting_fund_steem: '100000000.000 STEEM',
};

async function fulfillGlobalProps(page: Page) {
  await page.route('**/api/query/global-props', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, props: GLOBAL_PROPS }),
    }),
  );
}

async function interceptClaimBroadcast(page: Page) {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/broadcast/claim-reward-balance', (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, result: { id: 'e2e-tx' } }),
    });
  });
  return bodies;
}

async function abortOtherQueries(page: Page) {
  // Registered FIRST so later-registered routes win (Playwright consults the
  // most recently registered matching route first).
  await page.route('**/api/query/**', (route) => route.abort());
}

function trackAuthEndpoints(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/\/api\/auth\/(challenge|login|logout)/.test(url)) urls.push(url);
  });
  return urls;
}

// ---------------------------------------------------------------------------
// Work Mode modal helpers (mirror of the other vault specs)
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

async function ackBackupConfirmation(page: Page) {
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Back up your vault' }),
  });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const continueButton = dialog.getByRole('button', { name: 'Continue', exact: true });
  await expect(continueButton).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(dialog).toBeHidden();
}

async function createVaultViaEmptyDialog(page: Page, modal: Locator, name: string) {
  const emptyDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'No vaults yet' }),
  });
  await emptyDialog
    .getByRole('button', { name: 'Create a new vault' })
    .click({ timeout: 15_000 });
  const form = modal.getByTestId('vault-create-form');
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.getByLabel('Vault name').fill(name);
  await form.getByLabel('Vault password', { exact: true }).fill(VAULT_PASSWORD);
  await form.getByLabel('Confirm vault password').fill(VAULT_PASSWORD);
  await form.getByRole('button', { name: 'Create vault' }).click();
  await ackBackupConfirmation(page);
  await expect(modal.getByTestId('vault-row').filter({ hasText: name })).toBeVisible({
    timeout: 15_000,
  });
}

async function openKeyManager(page: Page, modal: Locator, vaultName: string) {
  const row = modal.getByTestId('vault-row').filter({ hasText: vaultName });
  // Cold-start hardening (A6-T6): wait for the row and the menu item to be
  // visible BEFORE clicking (raw clicks timed out on cold compiles).
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: 'Manage', exact: true }).click();
  const manageKeysItem = page.getByRole('menuitem', { name: 'Manage keys' });
  await expect(manageKeysItem).toBeVisible({ timeout: 15_000 });
  await manageKeysItem.click();
  const view = page.getByTestId('vault-key-manager');
  await expect(view).toBeVisible({ timeout: 15_000 });
  return view;
}

// ---------------------------------------------------------------------------
// Migration dialog helpers
// ---------------------------------------------------------------------------

/**
 * Drive the migration dialog to the verdict: open, assert the confirmation
 * copy, fill the vault password (plus the CONFIRM re-type when the target
 * vault is empty — the anchoring case), verify on-chain (intercepted).
 */
async function migrateDialogToVerdict(page: Page, view: Locator, password: string) {
  await view.getByRole('button', { name: 'Migrate remembered key' }).click();
  const form = page.getByTestId('vault-migrate-form');
  await expect(form).toBeVisible({ timeout: 15_000 });

  // Consent copy: the three consequences + the username note, the account
  // and the derived public key (truncated), all BEFORE anything runs.
  await expect(form.getByText('What this does:')).toBeVisible();
  await expect(form.getByText(/encrypted and stored in this vault/)).toBeVisible();
  await expect(form.getByText(/plaintext copy kept by “Remember me”/)).toBeVisible();
  await expect(form.getByText(/no longer auto-restore this key/)).toBeVisible();
  await expect(form.getByText(/remembered username stays/)).toBeVisible();
  await expect(form.getByLabel('Account')).toHaveValue('alice');
  await expect(form.getByText(shortPublicKey(fixtureKey('posting').publicKey))).toBeVisible();

  await form.locator('#vault-migrate-password').fill(password);
  // The (async) anchoring decision must land before the confirm handling:
  // 'empty' target -> the confirm re-type is required too.
  await expect(form).not.toHaveAttribute('data-anchor-case', 'pending');
  if ((await form.getAttribute('data-anchor-case')) === 'empty') {
    await form.getByLabel('Confirm vault password').fill(password);
  }
  await form.getByRole('button', { name: 'Verify on-chain' }).click();
  const verdict = form.getByTestId('vault-migrate-verification');
  await expect(verdict).toBeVisible({ timeout: 20_000 });
  await expect(verdict).toContainText(
    /Verified: this key matches the on-chain Posting authority \(weight 1 of 1\)/,
  );
  return form;
}

/** Full happy-path migration through the UI (verdict -> confirm -> banner). */
async function migrateThroughDialog(page: Page, view: Locator) {
  const form = await migrateDialogToVerdict(page, view, VAULT_PASSWORD);
  await form.getByRole('button', { name: 'Migrate now' }).click();
  await expect(form).toBeHidden({ timeout: 30_000 });
  await expect(
    view.getByText('Remembered key moved into the vault and removed from this device.'),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Add the fixture ACTIVE key for alice through the add-key dialog — used to
 * give a freshly created (EMPTY) vault a password anchor before testing the
 * wrong-password migration path (an empty vault accepts any password by
 * design: the first added key's password IS the anchor).
 */
async function anchorVaultWithActiveKey(page: Page, view: Locator) {
  const activeKey = fixtureKey('active');
  await view.getByRole('button', { name: 'Add key', exact: true }).click();
  const form = page.getByTestId('vault-add-key-form');
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.getByLabel('Account name').fill('alice');
  await form.locator('#vault-add-key-role').selectOption('active');
  await form.getByLabel('Private key (WIF)').fill(activeKey.privateKey);
  await form.getByLabel('Note (optional)').fill('anchor key');
  await form
    .getByLabel('Vault password (used only to encrypt this key)')
    .fill(VAULT_PASSWORD);
  await form.getByTestId('vault-add-key-primary').click();
  await expect(form.getByTestId('vault-add-key-verification')).toBeVisible({
    timeout: 20_000,
  });
  await form.getByTestId('vault-add-key-primary').click();
  await expect(form).toBeHidden({ timeout: 30_000 });
  await expect(view.getByText('Key added to the vault.')).toBeVisible({ timeout: 15_000 });
}

test.describe('Vault plaintext migration (A6-T5)', () => {
  test.setTimeout(180_000);

  test('happy path: migrate the remembered key, plaintext removed, username kept, directory shows the key', async ({
    page,
  }) => {
    const postingKey = fixtureKey('posting');
    await seedRememberedPair(page, 'alice', postingKey.privateKey);
    await abortOtherQueries(page);
    await fulfillAccountsRoute(page, {
      alice: chainAccount('alice', { posting: [[postingKey.publicKey, 1]] }),
    });

    await page.goto('/login');
    // Before any vault exists there is no entry point to check yet; create
    // the target vault first.
    const modal = await openWorkModeModal(page);
    await switchToVaultMode(modal);
    await createVaultViaEmptyDialog(page, modal, 'Migration Vault');
    const view = await openKeyManager(page, modal, 'Migration Vault');

    // The remembered pair is seeded -> the entry point renders.
    const migrateButton = view.getByTestId('vault-migrate-remembered-button');
    await expect(migrateButton).toBeVisible({ timeout: 15_000 });
    expect(await rememberedState(page)).toEqual({
      postingKey: postingKey.privateKey,
      username: 'alice',
    });

    await migrateThroughDialog(page, view);

    // DELETION GATE visible end-to-end: the plaintext is gone, the username
    // deliberately stays.
    expect(await rememberedState(page)).toEqual({ postingKey: null, username: 'alice' });

    // The public directory lists the migrated posting key: the fixed
    // migration note, the role count and the truncated public key.
    const accountRow = view.getByTestId('vault-key-account').filter({ hasText: 'alice' });
    await expect(accountRow).toBeVisible();
    await expect(accountRow.getByText('Posting 1')).toBeVisible();
    await expect(
      accountRow.getByText("Migrated from the device's remembered posting key"),
    ).toBeVisible();
    await expect(
      accountRow.getByText(shortPublicKey(postingKey.publicKey)),
    ).toBeVisible();

    // The entry point disappeared with the plaintext (nothing left to
    // migrate on this device).
    await expect(migrateButton).toHaveCount(0);

    await closeWorkModeModal(modal);
  });

  test('empty-vault anchoring: confirm re-type + creation-level password policy before the migration may run (r1 P1-1)', async ({
    page,
  }) => {
    const postingKey = fixtureKey('posting');
    await seedRememberedPair(page, 'alice', postingKey.privateKey);
    await abortOtherQueries(page);
    await fulfillAccountsRoute(page, {
      alice: chainAccount('alice', { posting: [[postingKey.publicKey, 1]] }),
    });

    await page.goto('/login');
    const modal = await openWorkModeModal(page);
    await switchToVaultMode(modal);
    await createVaultViaEmptyDialog(page, modal, 'Anchor Vault');
    const view = await openKeyManager(page, modal, 'Anchor Vault');

    await view.getByRole('button', { name: 'Migrate remembered key' }).click();
    const form = page.getByTestId('vault-migrate-form');
    await expect(form).toBeVisible({ timeout: 15_000 });

    // The EMPTY target raises the bar: the anchoring hint + the confirm
    // re-type render (the typed password becomes the vault's password).
    await expect(form.getByText(/password you type becomes its vault password/)).toBeVisible();
    const confirmField = form.getByLabel('Confirm vault password');
    await expect(confirmField).toBeVisible();

    // (1) Typo: mismatched confirm blocks the flow with the shared mismatch
    // error — nothing runs, the plaintext is untouched.
    await form.locator('#vault-migrate-password').fill(VAULT_PASSWORD);
    await confirmField.fill(`${VAULT_PASSWORD}-typo`);
    await expect(form.getByText('Passwords do not match.')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Verify on-chain' })).toBeDisabled();
    expect(await rememberedState(page)).toEqual({
      postingKey: postingKey.privateKey,
      username: 'alice',
    });

    // (2) Weak anchoring password: matched confirm, but the creation policy
    // rejects it before ANY chain work or write.
    await form.locator('#vault-migrate-password').fill('short');
    await confirmField.fill('short');
    await form.getByRole('button', { name: 'Verify on-chain' }).click();
    await expect(form.getByText(/This password is too weak/)).toBeVisible({
      timeout: 15_000,
    });
    expect(await rememberedState(page)).toEqual({
      postingKey: postingKey.privateKey,
      username: 'alice',
    });

    // (3) Correct, confirmed, policy-valid: the full flow succeeds and only
    // now deletes the plaintext.
    await form.locator('#vault-migrate-password').fill(VAULT_PASSWORD);
    await confirmField.fill(VAULT_PASSWORD);
    await form.getByRole('button', { name: 'Verify on-chain' }).click();
    await expect(form.getByTestId('vault-migrate-verification')).toBeVisible({
      timeout: 20_000,
    });
    await form.getByRole('button', { name: 'Migrate now' }).click();
    await expect(form).toBeHidden({ timeout: 30_000 });
    expect(await rememberedState(page)).toEqual({ postingKey: null, username: 'alice' });

    await closeWorkModeModal(modal);
  });

  test('vault identity session signs with the migrated key (claim rewards, posting floor)', async ({
    page,
  }) => {
    const postingKey = fixtureKey('posting');
    await seedRememberedPair(page, 'alice', postingKey.privateKey);
    await abortOtherQueries(page);
    await fulfillTransactionHeader(page);
    await fulfillGlobalProps(page);
    const broadcastBodies = await interceptClaimBroadcast(page);
    const authEndpoints = trackAuthEndpoints(page);

    const PENDING_REWARDS = {
      reward_steem_balance: '0.500 STEEM',
      reward_sbd_balance: '0.000 SBD',
      reward_vesting_steem: '2.000 STEEM',
      reward_vesting_balance: '9.876543 VESTS',
    };
    await fulfillAccountsRoute(page, {
      alice: chainAccount('alice', {
        posting: [[postingKey.publicKey, 1]],
        rewards: PENDING_REWARDS,
      }),
    });

    await page.goto('/login');
    const modal = await openWorkModeModal(page);
    await switchToVaultMode(modal);
    await createVaultViaEmptyDialog(page, modal, 'Signing Vault');
    const view = await openKeyManager(page, modal, 'Signing Vault');
    await migrateThroughDialog(page, view);
    await closeWorkModeModal(modal);

    // Identity login for the migrated account, then claim with the migrated
    // key: the ciphertext that replaced the plaintext must actually sign.
    // This navigation re-ran the (disarmed) seeding script — the signing
    // phase below genuinely runs WITHOUT the device plaintext.
    await page.goto('/login');
    expect(
      await page.evaluate(
        ({ key }) => window.localStorage.getItem(key),
        { key: REMEMBERED_POSTING_KEY_KEY },
      ),
    ).toBeNull();
    const accountSelect = page.getByTestId('vault-login-account-select');
    await expect(accountSelect).toBeVisible({ timeout: 15_000 });
    await accountSelect.selectOption('alice');
    await page.getByTestId('vault-login-submit').click();
    await expect(page).toHaveURL(/\/@alice\/transfers$/, { timeout: 15_000 });

    const claimButton = page.getByRole('button', { name: 'Redeem Rewards' });
    await expect(claimButton).toBeVisible({ timeout: 15_000 });
    await claimButton.click();

    const signDialog = page.getByTestId('vault-signing-dialog');
    await expect(signDialog).toBeVisible({ timeout: 15_000 });
    // The migrated key is the offered candidate (its note identifies it).
    await expect(
      signDialog.getByText("Migrated from the device's remembered posting key"),
    ).toBeVisible();

    await signDialog.getByLabel('Vault password').fill(VAULT_PASSWORD);
    await signDialog.getByTestId('vault-signing-submit').click();
    await expect(signDialog).toBeHidden({ timeout: 30_000 });

    await expect(broadcastBodies).toHaveLength(1);
    const body = broadcastBodies[0] as {
      username?: string;
      signedTx?: { operations?: unknown[]; signatures?: string[] };
    };
    expect(body.username).toBe('alice');
    expect(body.signedTx?.operations).toEqual([
      [
        'claim_reward_balance',
        {
          account: 'alice',
          reward_steem: PENDING_REWARDS.reward_steem_balance,
          reward_sbd: PENDING_REWARDS.reward_sbd_balance,
          reward_vests: PENDING_REWARDS.reward_vesting_balance,
        },
      ],
    ]);
    expect(body.signedTx?.signatures?.length).toBe(1);
    // Signer identity (review r1 P3-6): recover the signature against the
    // MIGRATED posting key's public key — the broadcast was really signed by
    // the key that replaced the plaintext. Negative control: the active
    // fixture key does NOT verify. Both sides use steem-js's default chain
    // id (the app never overrides it client-side).
    expect(steem.auth.verifyTransaction(body.signedTx, postingKey.publicKey)).toBe(true);
    expect(steem.auth.verifyTransaction(body.signedTx, fixtureKey('active').publicKey)).toBe(
      false,
    );

    // Identity + signing stayed local (no classic auth endpoints).
    expect(authEndpoints).toEqual([]);
  });

  test('failure paths: wrong password and cancel leave the plaintext intact; retry succeeds', async ({
    page,
  }) => {
    const postingKey = fixtureKey('posting');
    const activeKey = fixtureKey('active');
    await seedRememberedPair(page, 'alice', postingKey.privateKey);
    await abortOtherQueries(page);
    await fulfillAccountsRoute(page, {
      alice: chainAccount('alice', {
        posting: [[postingKey.publicKey, 1]],
        active: [[activeKey.publicKey, 1]],
      }),
    });

    await page.goto('/login');
    const modal = await openWorkModeModal(page);
    await switchToVaultMode(modal);
    await createVaultViaEmptyDialog(page, modal, 'Failure Vault');
    const view = await openKeyManager(page, modal, 'Failure Vault');
    // An EMPTY vault accepts any password by design (the first added key's
    // password is the anchor), so anchor it with a real key first to make
    // the wrong-password path meaningful.
    await anchorVaultWithActiveKey(page, view);

    // Wrong vault password: the verdict renders (chain check passed), the
    // MIGRATE call fails the password authentication -> mapped error, the
    // dialog stays, the plaintext is untouched.
    const form = await migrateDialogToVerdict(page, view, 'wrong-password-not-it');
    await form.getByRole('button', { name: 'Migrate now' }).click();
    await expect(form.getByText('Incorrect password.')).toBeVisible({ timeout: 30_000 });
    expect(await rememberedState(page)).toEqual({
      postingKey: postingKey.privateKey,
      username: 'alice',
    });

    // Back -> cancel: still intact.
    await form.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(form.getByTestId('vault-migrate-verification')).toHaveCount(0);
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(form).toBeHidden();
    expect(await rememberedState(page)).toEqual({
      postingKey: postingKey.privateKey,
      username: 'alice',
    });

    // Retry with the correct password: the same dialog run succeeds — no
    // deletion happened on the failures, and nothing was left half-gated.
    await migrateThroughDialog(page, view);
    expect(await rememberedState(page)).toEqual({ postingKey: null, username: 'alice' });

    await closeWorkModeModal(modal);
  });

  test('red line: after migration, switching back to privateKey keeps the classic login working', async ({
    page,
  }) => {
    const postingKey = fixtureKey('posting');
    await seedRememberedPair(page, 'alice', postingKey.privateKey);
    await abortOtherQueries(page);
    await fulfillAccountsRoute(page, {
      alice: chainAccount('alice', { posting: [[postingKey.publicKey, 1]] }),
    });

    await page.goto('/login');
    const modal = await openWorkModeModal(page);
    await switchToVaultMode(modal);
    await createVaultViaEmptyDialog(page, modal, 'Switchback Vault');
    const view = await openKeyManager(page, modal, 'Switchback Vault');
    await migrateThroughDialog(page, view);

    // Switch the device mode back to privateKey.
    const privateKeyRadio = modal.locator('[data-mode="privateKey"]');
    await privateKeyRadio.click();
    await expect(privateKeyRadio).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
    await closeWorkModeModal(modal);

    // The classic login never depended on the remembered key: the form
    // renders, the KEPT remembered username prefills it, and a WIF login
    // goes through the (intercepted) challenge/login endpoints.
    await page.goto('/login');
    // EMPIRICAL seed-disarm check (r2 N1): this navigation ran the init
    // script again — the plaintext must STILL be gone (a re-seeding guard
    // bug would resurrect it here and pollute every retention assertion).
    expect(await rememberedState(page)).toEqual({ postingKey: null, username: 'alice' });
    await expect(page.getByTestId('vault-login-form')).toHaveCount(0);
    const usernameInput = page.locator('#username');
    await expect(usernameInput).toBeVisible({ timeout: 15_000 });
    await expect(usernameInput).toHaveValue('alice'); // username survived the migration
    await page.locator('#password').fill(postingKey.privateKey);

    let challengeRequests = 0;
    await page.route('**/api/auth/challenge*', (route) => {
      challengeRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ challenge: 'e2e-migration-challenge' }),
      });
    });
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      }),
    );

    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/@alice\/transfers$/, { timeout: 15_000 });
    expect(challengeRequests).toBe(1);
  });
});
