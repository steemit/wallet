// Session key source tests (A6-T1) — three layers:
//  1. the getter contract against the REAL auth slice (makeStore + the real
//     setCredentials/setVaultIdentity/logout reducers): role mapping,
//     normalizeSteemUsername-based account matching, and every fail-closed
//     case (no store bound / not logged in / account mismatch / role key
//     absent with NO privateKey-compat fallback / vault identity session /
//     logout);
//  2. facade integration: a privateKey-mode request routes to the REAL
//     legacy signer fed by this getter (fake IndexedDB settings row; the
//     vault backend stays a mock). steem-js is the global mock, so
//     assertions prove the CALL CONTRACT (which WIF reached signTransaction)
//     — never signature authenticity; account mismatch maps to
//     VAULT_KEY_INVALID and vault-mode routing is untouched;
//  3. the composition root: getVaultRuntime() (the real singleton in
//     vault-manager.tsx) returns a facade whose privateKey mode actually
//     signs with the session key — the exact wiring A6-T1 delivers.
//
// WIFs come from the shared test fixtures (fixture-recompute discipline);
// none are copied into src/. Real-crypto WIF evidence lives in
// tests/node/vault-wif-real-check.mjs (untouched by A6-T1 — the getter does
// no WIF validation of its own; validateVaultWif inside the signer runs
// under the global mock as in vault-signer.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { steem } from '@steemit/steem-js';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import { REMEMBERED_POSTING_KEY_KEY } from '@/lib/auth/browser-storage';
import { createLegacyPrivateKeySigner } from '@/lib/auth/legacy-private-key-signer';
import {
  bindSessionKeyStore,
  createSessionKeyGetter,
  resetSessionKeyStore,
} from '@/lib/auth/session-key-source';
import {
  getVaultRuntime,
  resetVaultRuntime,
} from '@/components/vault/vault-manager';
import { createSigningFacade } from '@/lib/vault/signing-facade';
import { openVaultRegistry, type VaultRegistry } from '@/lib/vault/registry';
import type { SignOperationsRequest, VaultSigner } from '@/lib/vault/types';
import { makeStore, type AppStore } from '@/lib/store';
import { setCredentials, setVaultIdentity, logout } from '@/lib/store/slices/auth';

// Importing vault-manager pulls next-intl; it is only used inside components
// (never rendered here), but mock it defensively like vault-manager-panel
// tests do so nothing depends on a request config at import time.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const v = vectors.vault;
const posting = v.keys[0];
const active = v.keys[1];
if (!posting || !active) throw new Error('fixture needs two keys');
const alicePostingWif = posting.privateKey;
const aliceActiveWif = active.privateKey;
// Synthetic labels (never real WIFs) for fields the getter must merely
// carry; the mock steem-js accepts any string.
const aliceOwnerWif = '5Ktest-session-owner-wif';
// The vitest mock derives 'STM' + the last 8 characters of the WIF.
const alicePostingPublicKey = `STM${alicePostingWif.slice(-8)}`;

// One header response for every signing case (shape copied from
// /api/query/transaction-header — same source as vault-signer.test.ts).
const TRANSACTION_HEADER = {
  success: true,
  ref_block_num: 99,
  ref_block_prefix: 3704360964,
  expiration: '2030-01-01T12:00:00',
};

/** The posting-class operation used across the signing cases. */
const postingOp = (account: string): [string, Record<string, unknown>] => [
  'custom_json',
  { required_posting_auths: [account], id: 'community', json: '[]' },
];

const signRequest = (
  overrides: Partial<SignOperationsRequest> = {},
): SignOperationsRequest => ({
  accountName: 'alice',
  role: 'posting',
  // Inert labels for the vault-only fields the legacy backend ignores.
  keyIv: 'private-key-mode',
  vaultPassword: 'private-key-mode',
  operations: [postingOp('alice')],
  ...overrides,
});

function stubHeaderFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      json: async () => TRANSACTION_HEADER,
    })),
  );
}

function mockBackend(): { backend: VaultSigner; signOperations: ReturnType<typeof vi.fn> } {
  const signOperations = vi.fn();
  const signResolvedTransaction = vi.fn();
  return { backend: { signOperations, signResolvedTransaction }, signOperations };
}

describe('session key source (A6-T1)', () => {
  let store: AppStore;

  beforeEach(() => {
    resetSessionKeyStore();
    store = makeStore();
  });

  afterEach(() => {
    resetSessionKeyStore();
    // Drop any decoy remembered key a test seeded (nothing else in this file
    // touches localStorage).
    localStorage.removeItem(REMEMBERED_POSTING_KEY_KEY);
    vi.unstubAllGlobals();
    vi.mocked(steem.auth.signTransaction).mockClear();
  });

  describe('getter: role mapping over the real auth slice', () => {
    it('returns the session key of each role for the logged-in account', () => {
      bindSessionKeyStore(store);
      store.dispatch(
        setCredentials({
          username: 'alice',
          ownerKey: aliceOwnerWif,
          activeKey: aliceActiveWif,
          postingKey: alicePostingWif,
        }),
      );
      const getter = createSessionKeyGetter();
      expect(getter('alice', 'posting')).toBe(alicePostingWif);
      expect(getter('alice', 'active')).toBe(aliceActiveWif);
      expect(getter('alice', 'owner')).toBe(aliceOwnerWif);
    });

    it('matches account names through normalizeSteemUsername (case, spaces, @)', () => {
      bindSessionKeyStore(store);
      store.dispatch(setCredentials({ username: 'alice', postingKey: alicePostingWif }));
      const getter = createSessionKeyGetter();
      expect(getter('Alice', 'posting')).toBe(alicePostingWif);
      expect(getter('  @ALICE ', 'posting')).toBe(alicePostingWif);
      // The session side is normalized too.
      store.dispatch(setCredentials({ username: 'Alice', postingKey: alicePostingWif }));
      expect(getter('alice', 'posting')).toBe(alicePostingWif);
    });

    it('fails closed when no store is bound, nobody is logged in, or the account differs', () => {
      const getter = createSessionKeyGetter();
      // No store bound yet.
      expect(getter('alice', 'posting')).toBeUndefined();
      // A fresh store: username null.
      bindSessionKeyStore(store);
      expect(getter('alice', 'posting')).toBeUndefined();
      // Logged in as alice — a request for another account gets nothing.
      store.dispatch(setCredentials({ username: 'alice', postingKey: alicePostingWif }));
      expect(getter('bob', 'posting')).toBeUndefined();
    });

    it('returns undefined for a role the session holds no key for (no privateKey fallback)', () => {
      bindSessionKeyStore(store);
      store.dispatch(setCredentials({ username: 'alice', postingKey: alicePostingWif }));
      const getter = createSessionKeyGetter();
      expect(getter('alice', 'active')).toBeUndefined();
      expect(getter('alice', 'owner')).toBeUndefined();
      // The slice's legacy `privateKey` compat field is NOT a role source:
      // signing a role request with "typically active" key material would
      // change which authority the session proves.
      store.dispatch(setCredentials({ username: 'alice', privateKey: '5JcompatPrimary' }));
      expect(getter('alice', 'owner')).toBeUndefined();
      expect(getter('alice', 'active')).toBeUndefined();
      expect(getter('alice', 'posting')).toBeUndefined();
    });

    it('holds no keys for a vault identity session and after logout (fail closed)', () => {
      bindSessionKeyStore(store);
      store.dispatch(setCredentials({ username: 'alice', postingKey: alicePostingWif }));
      const getter = createSessionKeyGetter();
      // setVaultIdentity wipes every key field (invariant 21).
      store.dispatch(setVaultIdentity({ username: 'alice' }));
      expect(getter('alice', 'posting')).toBeUndefined();
      // A privateKey session followed by logout loses its keys as well.
      store.dispatch(setCredentials({ username: 'alice', postingKey: alicePostingWif }));
      expect(getter('alice', 'posting')).toBe(alicePostingWif);
      store.dispatch(logout());
      expect(getter('alice', 'posting')).toBeUndefined();
    });

    it('reads state at call time — later dispatches are seen without re-binding', () => {
      bindSessionKeyStore(store);
      const getter = createSessionKeyGetter();
      expect(getter('alice', 'posting')).toBeUndefined();
      store.dispatch(setCredentials({ username: 'alice', postingKey: alicePostingWif }));
      expect(getter('alice', 'posting')).toBe(alicePostingWif);
    });
  });

  describe('facade integration: privateKey mode routes through the legacy signer', () => {
    let fake: FakeIndexedDBHandle;
    let registry: VaultRegistry;

    beforeEach(async () => {
      fake = installFakeIndexedDB();
      registry = await openVaultRegistry();
      // Touch the settings store once so the fake database exists for wrappers.
      await registry.getSettings();
      bindSessionKeyStore(store);
      store.dispatch(setCredentials({ username: 'alice', postingKey: alicePostingWif }));
      stubHeaderFetch();
    });

    afterEach(() => {
      registry.close();
      fake.uninstall();
      fake.reset();
    });

    function buildFacade(vaultBackend: VaultSigner) {
      return createSigningFacade(registry, {
        vaultSigner: vaultBackend,
        legacySigner: createLegacyPrivateKeySigner(createSessionKeyGetter()),
      });
    }

    it('signs a privateKey-mode request with the session key; vault backend untouched', async () => {
      const vault = mockBackend();
      const facade = buildFacade(vault.backend);
      await expect(facade.getSigningMode()).resolves.toBe('privateKey');
      const result = await facade.signOperations(signRequest());
      expect(vault.signOperations).not.toHaveBeenCalled();
      // The session WIF is what reached the (mocked) signer — call contract.
      expect(vi.mocked(steem.auth.signTransaction)).toHaveBeenCalledTimes(1);
      const call = vi.mocked(steem.auth.signTransaction).mock.calls[0];
      expect(call).toBeDefined();
      const [, keys] = call as [Record<string, unknown>, string[]];
      expect(keys).toEqual([alicePostingWif]);
      expect(result.role).toBe('posting');
      expect(result.publicKey).toBe(alicePostingPublicKey);
      expect(result.locked).toBe(false);
      expect(JSON.stringify(result)).not.toContain(alicePostingWif);
    });

    it('maps an account mismatch / missing role key to VAULT_KEY_INVALID (no signing call)', async () => {
      const facade = buildFacade(mockBackend().backend);
      await expect(facade.signOperations(signRequest({ accountName: 'bob' }))).rejects.toMatchObject(
        { code: 'VAULT_KEY_INVALID' },
      );
      // The session only holds a posting key — an active-class request fails.
      await expect(
        facade.signOperations(
          signRequest({
            role: 'active',
            operations: [
              [
                'transfer',
                { from: 'alice', to: 'bob', amount: '1.000 STEEM', memo: 'demo' },
              ],
            ],
          }),
        ),
      ).rejects.toMatchObject({ code: 'VAULT_KEY_INVALID' });
      expect(vi.mocked(steem.auth.signTransaction)).not.toHaveBeenCalled();
    });

    it('keeps vault-mode dispatch untouched (vault backend only)', async () => {
      const vault = mockBackend();
      vault.signOperations.mockResolvedValue({ ok: 'vault-operations' } as never);
      const facade = buildFacade(vault.backend);
      await facade.setSigningMode('vault');
      await expect(facade.signOperations(signRequest())).resolves.toEqual({
        ok: 'vault-operations',
      });
      expect(vault.signOperations).toHaveBeenCalledTimes(1);
      expect(vi.mocked(steem.auth.signTransaction)).not.toHaveBeenCalled();
    });

    it('never falls back to the remembered localStorage posting key (red line)', async () => {
      // A decoy sits in the REAL browser-storage slot for remembered posting
      // keys. The session key source must read ONLY the Redux session: the
      // remembered-key restore stays the claim-banner-specific affordance
      // (invariant 21), so the getter/facade must fail closed to
      // VAULT_KEY_INVALID even with a perfectly usable WIF in localStorage.
      const decoy = '5Jdecoy-remembered-posting-key';
      localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, decoy);
      const getter = createSessionKeyGetter();
      const facade = buildFacade(mockBackend().backend);

      // Session holds an active key but NO posting key.
      store.dispatch(setCredentials({ username: 'alice', activeKey: aliceActiveWif }));
      expect(getter('alice', 'posting')).toBeUndefined();
      await expect(facade.signOperations(signRequest())).rejects.toMatchObject({
        code: 'VAULT_KEY_INVALID',
      });

      // A session that DID hold the posting key loses it on logout — the
      // decoy is still ignored.
      store.dispatch(setCredentials({ username: 'alice', postingKey: alicePostingWif }));
      expect(getter('alice', 'posting')).toBe(alicePostingWif);
      store.dispatch(logout());
      expect(getter('alice', 'posting')).toBeUndefined();
      await expect(facade.signOperations(signRequest())).rejects.toMatchObject({
        code: 'VAULT_KEY_INVALID',
      });

      expect(vi.mocked(steem.auth.signTransaction)).not.toHaveBeenCalled();
      // The decoy was never consumed or cleared by the signing path.
      expect(localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBe(decoy);
    });
  });

  describe('composition root: getVaultRuntime wires the legacy backend', () => {
    let fake: FakeIndexedDBHandle;

    beforeEach(() => {
      fake = installFakeIndexedDB();
      resetVaultRuntime();
      bindSessionKeyStore(store);
      store.dispatch(setCredentials({ username: 'alice', postingKey: alicePostingWif }));
      stubHeaderFetch();
    });

    afterEach(() => {
      resetVaultRuntime();
      fake.uninstall();
      fake.reset();
    });

    it('privateKey-mode signing through the runtime facade uses the session key', async () => {
      const { facade } = await getVaultRuntime();
      await expect(facade.getSigningMode()).resolves.toBe('privateKey');
      const result = await facade.signOperations(signRequest());
      expect(result.locked).toBe(false);
      expect(result.publicKey).toBe(alicePostingPublicKey);
      expect(vi.mocked(steem.auth.signTransaction)).toHaveBeenCalledTimes(1);
      const call = vi.mocked(steem.auth.signTransaction).mock.calls[0];
      expect(call).toBeDefined();
      const [, keys] = call as [Record<string, unknown>, string[]];
      expect(keys).toEqual([alicePostingWif]);
    });

    it('exposes the legacy and vault backends for session-kind routing (A6-T2)', async () => {
      const { facade, legacySigner, vaultSigner } = await getVaultRuntime();
      // The exposed backends are the exact instances the facade dispatches
      // to — useSessionSigning routes on session kind through them.
      const legacyResult = await legacySigner.signOperations(signRequest());
      expect(legacyResult.publicKey).toBe(alicePostingPublicKey);
      expect(legacyResult.locked).toBe(false);
      // Same instance identity as the facade's privateKey backend (mode row
      // reads 'privateKey' in this fake registry).
      const mode = await facade.getSigningMode();
      expect(mode).toBe('privateKey');
      const vaultKeys = Object.keys(vaultSigner);
      expect(vaultKeys).toContain('signOperations');
      expect(vaultKeys).toContain('signResolvedTransaction');
    });

    it('fails closed to VAULT_KEY_INVALID when no session store is bound', async () => {
      const { facade } = await getVaultRuntime();
      resetSessionKeyStore();
      await expect(facade.signOperations(signRequest())).rejects.toMatchObject({
        code: 'VAULT_KEY_INVALID',
      });
      expect(vi.mocked(steem.auth.signTransaction)).not.toHaveBeenCalled();
    });
  });
});
