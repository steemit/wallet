import { test, expect, type Locator, type Page } from '@playwright/test';
import vectors from '../fixtures/vault-development-test-vectors.json';

/**
 * Vault identity session SIGNING (A6-T2 pilot, A6-T3a wallet-ops batch) —
 * real-browser coverage for the per-key password path.
 *
 * Setup mirrors vault-per-key.spec.ts (real IndexedDB + real Web Crypto;
 * chain-dependent branches made deterministic by intercepting
 * /api/query/accounts — the helpers below are a focused copy of that spec's,
 * which keeps each spec self-contained per the e2e convention here).
 *
 * Covered:
 *  - identity login -> transfer modal (NO classic re-auth gate for a vault
 *    session on the transfer action) -> preview -> confirm -> the vault
 *    signing dialog: single active-key candidate auto-selected (posting keys
 *    stay below the active floor), note rendered;
 *  - wrong vault password -> mapped "Incorrect password." + retry hint, the
 *    typed value cleared, dialog stays;
 *  - correct password -> signed transaction broadcast (body intercepted:
 *    ref_block fields from the intercepted header + a signature) -> success
 *    closes both dialogs and the wallet modal;
 *  - delegate (A6-T3a): a vault session opens the delegate modal directly —
 *    the pre-A6 "Not authenticated" dead-end is gone — signs through the
 *    same password dialog and broadcasts the byte-identical
 *    delegate_vesting_shares tuple (SP converted through the intercepted
 *    global props);
 *  - claim rewards (A6-T3b): the banner's POSTING floor offers BOTH stored
 *    keys as radio candidates (the active-floor tests above exclude the
 *    posting key); picking the posting key and broadcasting the
 *    byte-identical full-pending-amounts claim_reward_balance tuple. (The
 *    "a vault session never reads the Legacy remembered posting key"
 *    invariant is NOT exercised here — it is pinned by the unit suite's
 *    Storage-prototype spy in tests/unit/claim-rewards-banner.test.tsx.);
 *  - no /api/auth/* traffic at any point (identity + signing are local).
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

// ---------------------------------------------------------------------------
// Controlled chain data (mirror of vault-per-key.spec.ts)
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
    owner?: ReadonlyArray<readonly [string, number]>;
    active?: ReadonlyArray<readonly [string, number]>;
    posting?: ReadonlyArray<readonly [string, number]>;
    balance?: string;
    /** Pending rewards (all four fields) so the claim banner renders. */
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
    owner: authority(1, spec.owner ?? [[OTHER_AUTHORITY_KEY, 1]]),
    active: authority(1, spec.active ?? [[OTHER_AUTHORITY_KEY, 1]]),
    posting: authority(1, spec.posting ?? [[OTHER_AUTHORITY_KEY, 1]]),
    memo_key: OTHER_MEMO_KEY,
    balance: spec.balance ?? '10.000 STEEM',
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

/** Transaction header for local signing (steem-js serializes it as-is). */
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

async function interceptBroadcast(page: Page) {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/broadcast/transfer', (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, result: { id: 'e2e-tx' } }),
    });
  });
  return bodies;
}

/** Intercept the delegate broadcast route, returning the captured bodies. */
async function interceptDelegateBroadcast(page: Page) {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/broadcast/delegate', (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, result: { id: 'e2e-tx' } }),
    });
  });
  return bodies;
}

/** Intercept the claim-rewards broadcast route, returning the captured bodies. */
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

/**
 * Global props for the delegate form's SP -> VESTS math. 200M VESTS over
 * 100M STEEM makes 1 SP convert to exactly 2.000000 VESTS.
 */
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

async function abortOtherQueries(page: Page) {
  // Registered FIRST so the later-registered accounts / transaction-header
  // routes win for their URLs (Playwright consults the most recently
  // registered matching route first) — this catch-all only mops up the rest.
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

/**
 * Open a wallet modal WITHOUT a full page load: a vault identity session
 * lives only in Redux (by design — invariant 21), so `page.goto` would wipe
 * it and land on an unauthenticated page. The pushState + popstate pair
 * drives the App Router's client-side navigation, exactly what the
 * balance-row action buttons do through next-intl's router.
 */
async function openWalletModalViaSpaNavigation(page: Page, query: string) {
  await page.evaluate((search) => {
    window.history.pushState({}, '', `/@alice/transfers${search}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, query);
}

async function openTransferModalViaSpaNavigation(page: Page) {
  await openWalletModalViaSpaNavigation(
    page,
    '?walletAction=transfer&asset=STEEM&type=transfer',
  );
}

// ---------------------------------------------------------------------------
// Work Mode modal helpers (mirror of vault-per-key.spec.ts)
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
  await row.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage keys' }).click();
  const view = page.getByTestId('vault-key-manager');
  await expect(view).toBeVisible({ timeout: 15_000 });
  return view;
}

async function addActiveKey(page: Page, view: Locator, account: string, wif: string, note: string) {
  await view.getByRole('button', { name: 'Add key', exact: true }).click();
  const form = page.getByTestId('vault-add-key-form');
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.getByLabel('Account name').fill(account);
  await form.locator('#vault-add-key-role').selectOption('active');
  await form.getByLabel('Private key (WIF)').fill(wif);
  await form.getByLabel('Note (optional)').fill(note);
  await form
    .getByLabel('Vault password (used only to encrypt this key)')
    .fill(VAULT_PASSWORD);
  await form.getByTestId('vault-add-key-primary').click();
  const verdict = form.getByTestId('vault-add-key-verification');
  await expect(verdict).toBeVisible({ timeout: 20_000 });
  await expect(verdict).toContainText(
    /Verified: this key matches the on-chain Active authority \(weight 1 of 1\)/,
  );
  await form.getByTestId('vault-add-key-primary').click();
  await expect(form).toBeHidden({ timeout: 30_000 });
}

/** Shared journey prefix: vault mode, one vault, alice active+posting keys, identity login. */
async function establishVaultIdentity(page: Page) {
  await page.goto('/');
  const modal = await openWorkModeModal(page);
  await switchToVaultMode(modal);
  await createVaultViaEmptyDialog(page, modal, 'Signing Vault');

  const activeKey = fixtureKey('active');
  const postingKey = fixtureKey('posting');
  const view = await openKeyManager(page, modal, 'Signing Vault');
  await addActiveKey(page, view, 'alice', activeKey.privateKey, 'trezor active key');
  // A second, POSTING-stored key: it must NOT appear among the active-floor
  // candidates in the signing dialog.
  await view.getByRole('button', { name: 'Add key', exact: true }).click();
  const postingForm = page.getByTestId('vault-add-key-form');
  await expect(postingForm).toBeVisible({ timeout: 15_000 });
  await postingForm.getByLabel('Account name').fill('alice');
  await postingForm.getByLabel('Private key (WIF)').fill(postingKey.privateKey);
  await postingForm.getByLabel('Note (optional)').fill('posting only key');
  await postingForm
    .getByLabel('Vault password (used only to encrypt this key)')
    .fill(VAULT_PASSWORD);
  await postingForm.getByTestId('vault-add-key-primary').click();
  await expect(postingForm.getByTestId('vault-add-key-verification')).toBeVisible({
    timeout: 20_000,
  });
  await postingForm.getByTestId('vault-add-key-primary').click();
  await expect(postingForm).toBeHidden({ timeout: 30_000 });

  await closeWorkModeModal(modal);

  await page.goto('/login');
  const accountSelect = page.getByTestId('vault-login-account-select');
  await expect(accountSelect).toBeVisible({ timeout: 15_000 });
  await accountSelect.selectOption('alice');
  await page.getByTestId('vault-login-submit').click();
  await expect(page).toHaveURL(/\/@alice\/transfers$/, { timeout: 15_000 });
}

test.describe('Vault identity session signing (A6-T2/T3a)', () => {
  test.setTimeout(180_000);

  test('transfer happy path: password dialog, wrong-password retry, signed + broadcast', async ({
    page,
  }) => {
    const activeKey = fixtureKey('active');
    const postingKey = fixtureKey('posting');
    // alice: the ACTIVE authority holds the active fixture key (the signer's
    // pre-check needs it); posting holds the posting fixture key (add-key
    // verdicts + below-floor exclusion).
    await abortOtherQueries(page);
    await fulfillTransactionHeader(page);
    const broadcastBodies = await interceptBroadcast(page);
    const authEndpoints = trackAuthEndpoints(page);

    const chain = {
      alice: chainAccount('alice', {
        active: [[activeKey.publicKey, 1]],
        posting: [[postingKey.publicKey, 1]],
      }),
      bob: chainAccount('bob'),
    };
    await fulfillAccountsRoute(page, chain);
    await establishVaultIdentity(page);

    // The transfer modal opens DIRECTLY for a vault session (no classic
    // re-auth form).
    await openTransferModalViaSpaNavigation(page);
    const toInput = page.getByLabel('To', { exact: true });
    await expect(toInput).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Sign in to continue')).toHaveCount(0);

    await toInput.fill('bob');
    await page.getByLabel('Amount').fill('1.000');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Pre-broadcast review (two-step flow preserved).
    const review = page.getByRole('dialog').filter({ hasText: 'Please review the transaction' });
    await expect(review).toBeVisible({ timeout: 15_000 });
    await expect(review.getByText('1.000 STEEM')).toBeVisible();
    await expect(review.getByText('bob')).toBeVisible();
    expect(broadcastBodies).toHaveLength(0);

    await review.getByRole('button', { name: 'Confirm', exact: true }).click();

    // The vault signing dialog layers above the wallet modal at z-60.
    const signDialog = page.getByTestId('vault-signing-dialog');
    await expect(signDialog).toBeVisible({ timeout: 15_000 });
    await expect(signDialog).toHaveCSS('z-index', '60');
    // Exactly one active-floor candidate (the active key) auto-selects: its
    // note renders and the posting-stored key is NOT offered.
    await expect(signDialog.getByText('trezor active key')).toBeVisible();
    await expect(signDialog.getByText('posting only key')).toHaveCount(0);
    await expect(signDialog.getByTestId('vault-signing-key-options')).toHaveCount(0);

    // Wrong password: mapped error + retry hint, cleared field, still open.
    await signDialog.getByLabel('Vault password').fill('definitely-wrong-password');
    await signDialog.getByTestId('vault-signing-submit').click();
    await expect(signDialog.getByText('Incorrect password.')).toBeVisible({ timeout: 30_000 });
    await expect(signDialog.getByText('Check the password and try again.')).toBeVisible();
    await expect(signDialog.getByLabel('Vault password')).toHaveValue('');
    expect(broadcastBodies).toHaveLength(0);

    // Correct password: signed + broadcast.
    await signDialog.getByLabel('Vault password').fill(VAULT_PASSWORD);
    await signDialog.getByTestId('vault-signing-submit').click();
    await expect(signDialog).toBeHidden({ timeout: 30_000 });
    await expect(review).toBeHidden({ timeout: 15_000 });

    await expect(broadcastBodies).toHaveLength(1);
    const body = broadcastBodies[0] as {
      username?: string;
      signedTx?: {
        ref_block_num?: number;
        ref_block_prefix?: number;
        operations?: unknown[];
        signatures?: string[];
      };
    };
    expect(body.username).toBe('alice');
    expect(body.signedTx?.ref_block_num).toBe(12345);
    expect(body.signedTx?.ref_block_prefix).toBe(6789012);
    expect(body.signedTx?.operations).toEqual([
      ['transfer', { from: 'alice', to: 'bob', amount: '1.000 STEEM', memo: '' }],
    ]);
    expect(body.signedTx?.signatures?.length).toBe(1);

    // Success closes the wallet modal (query params cleared).
    await expect(page).toHaveURL(/\/@alice\/transfers$/, { timeout: 15_000 });
    await expect(toInput).toHaveCount(0);

    // The whole flow — identity login + signing — never touched auth endpoints.
    expect(authEndpoints).toEqual([]);
  });

  test('cancel in the signing dialog aborts quietly: no broadcast, review re-usable', async ({
    page,
  }) => {
    const activeKey = fixtureKey('active');
    const postingKey = fixtureKey('posting');
    await abortOtherQueries(page);
    await fulfillTransactionHeader(page);
    const broadcastBodies = await interceptBroadcast(page);

    const chain = {
      alice: chainAccount('alice', {
        active: [[activeKey.publicKey, 1]],
        posting: [[postingKey.publicKey, 1]],
      }),
      bob: chainAccount('bob'),
    };
    await fulfillAccountsRoute(page, chain);
    await establishVaultIdentity(page);

    await openTransferModalViaSpaNavigation(page);
    await page.getByLabel('To', { exact: true }).fill('bob');
    await page.getByLabel('Amount').fill('2.000');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const review = page.getByRole('dialog').filter({ hasText: 'Please review the transaction' });
    await expect(review).toBeVisible({ timeout: 15_000 });
    await review.getByRole('button', { name: 'Confirm', exact: true }).click();

    const signDialog = page.getByTestId('vault-signing-dialog');
    await expect(signDialog).toBeVisible({ timeout: 15_000 });
    await signDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(signDialog).toBeHidden({ timeout: 15_000 });

    // No broadcast, no error banner — the review stays open for another try.
    expect(broadcastBodies).toHaveLength(0);
    await expect(review).toBeVisible();
    await expect(review.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  });

  test('delegate (A6-T3a): vault session gets the form directly, signs through the password dialog and broadcasts', async ({
    page,
  }) => {
    const activeKey = fixtureKey('active');
    const postingKey = fixtureKey('posting');
    await abortOtherQueries(page);
    await fulfillTransactionHeader(page);
    await fulfillGlobalProps(page);
    const broadcastBodies = await interceptDelegateBroadcast(page);
    const authEndpoints = trackAuthEndpoints(page);

    const chain = {
      alice: chainAccount('alice', {
        active: [[activeKey.publicKey, 1]],
        posting: [[postingKey.publicKey, 1]],
      }),
      bob: chainAccount('bob'),
    };
    await fulfillAccountsRoute(page, chain);
    await establishVaultIdentity(page);

    // The delegate modal opens DIRECTLY for a vault session (A6-T3a closed
    // the pre-A6 "Not authenticated" dead-end this form used to show).
    await openWalletModalViaSpaNavigation(page, '?walletAction=delegate');
    const delegateeInput = page.getByLabel('Delegatee Username');
    await expect(delegateeInput).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Sign in to continue')).toHaveCount(0);

    await delegateeInput.fill('bob');
    await page.getByLabel('SP to Delegate').fill('1');
    await page.getByRole('button', { name: 'Delegate', exact: true }).click();

    // The vault signing dialog layers above the wallet modal at z-60; the
    // single active-floor candidate auto-selects.
    const signDialog = page.getByTestId('vault-signing-dialog');
    await expect(signDialog).toBeVisible({ timeout: 15_000 });
    await expect(signDialog).toHaveCSS('z-index', '60');
    await expect(signDialog.getByText('trezor active key')).toBeVisible();
    await expect(signDialog.getByText('posting only key')).toHaveCount(0);

    await signDialog.getByLabel('Vault password').fill(VAULT_PASSWORD);
    await signDialog.getByTestId('vault-signing-submit').click();
    await expect(signDialog).toBeHidden({ timeout: 30_000 });

    // Byte-identical delegate tuple: 1 SP at the intercepted globals
    // (200M VESTS / 100M STEEM) converts to exactly 2.000000 VESTS.
    await expect(broadcastBodies).toHaveLength(1);
    const body = broadcastBodies[0] as {
      username?: string;
      signedTx?: {
        ref_block_num?: number;
        operations?: unknown[];
        signatures?: string[];
      };
    };
    expect(body.username).toBe('alice');
    expect(body.signedTx?.ref_block_num).toBe(12345);
    expect(body.signedTx?.operations).toEqual([
      [
        'delegate_vesting_shares',
        { delegator: 'alice', delegatee: 'bob', vesting_shares: '2.000000 VESTS' },
      ],
    ]);
    expect(body.signedTx?.signatures?.length).toBe(1);

    // Success closes the wallet modal (query params cleared).
    await expect(page).toHaveURL(/\/@alice\/transfers$/, { timeout: 15_000 });
    await expect(delegateeInput).toHaveCount(0);

    // The whole flow — identity login + signing — never touched auth endpoints.
    expect(authEndpoints).toEqual([]);
  });

  test('claim rewards (A6-T3b): posting floor offers both keys, signs and broadcasts the full-pending tuple', async ({
    page,
  }) => {
    const activeKey = fixtureKey('active');
    const postingKey = fixtureKey('posting');
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
    const chain = {
      alice: chainAccount('alice', {
        active: [[activeKey.publicKey, 1]],
        posting: [[postingKey.publicKey, 1]],
        rewards: PENDING_REWARDS,
      }),
      bob: chainAccount('bob'),
    };
    await fulfillAccountsRoute(page, chain);
    await establishVaultIdentity(page);

    // The wallet transfers page (already open after identity login) shows the
    // claim banner with the full pending amounts.
    const claimButton = page.getByRole('button', { name: 'Redeem Rewards' });
    await expect(claimButton).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Your current rewards: 0.500 STEEM and 2.000 SP')).toBeVisible();

    // The keyless hint stays hidden: a vault session signs via the dialog.
    await expect(page.getByText('Sign in with your password or posting key')).toHaveCount(0);

    await claimButton.click();

    // claim_reward_balance floors at POSTING, so BOTH stored keys (posting +
    // active) are offered — the posting-floor counterpart of the active-floor
    // exclusion the transfer/delegate tests pin. Pick the posting key
    // (least privilege; its public key sits in the intercepted posting
    // authority, satisfying the signer's pre-check).
    const signDialog = page.getByTestId('vault-signing-dialog');
    await expect(signDialog).toBeVisible({ timeout: 15_000 });
    await expect(signDialog.getByText('trezor active key')).toBeVisible();
    await expect(signDialog.getByText('posting only key')).toBeVisible();
    await expect(signDialog.getByTestId('vault-signing-key-options')).toBeVisible();
    await signDialog.getByText('posting only key').click();

    await signDialog.getByLabel('Vault password').fill(VAULT_PASSWORD);
    await signDialog.getByTestId('vault-signing-submit').click();
    await expect(signDialog).toBeHidden({ timeout: 30_000 });

    // Byte-identical claim tuple: the FULL pending amounts of all three
    // token types exactly as the account reports them (zero SBD included).
    await expect(broadcastBodies).toHaveLength(1);
    const body = broadcastBodies[0] as {
      username?: string;
      signedTx?: {
        ref_block_num?: number;
        ref_block_prefix?: number;
        operations?: unknown[];
        signatures?: string[];
      };
    };
    expect(body.username).toBe('alice');
    expect(body.signedTx?.ref_block_num).toBe(12345);
    expect(body.signedTx?.ref_block_prefix).toBe(6789012);
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

    // The whole flow — identity login + signing — never touched auth endpoints.
    expect(authEndpoints).toEqual([]);
  });
});
