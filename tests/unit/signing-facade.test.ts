// Signing facade tests (A4) — pure dispatch semantics over the registry's
// settings row. No PBKDF2 is paid anywhere in this file: both signing
// backends are injected mocks and the only real storage is the fake
// IndexedDB settings store (tests/mocks/fake-indexeddb.ts).
//
// The contracts under test: default mode privateKey; setSigningMode persists
// only on success (a failing putSettings leaves the stored mode untouched —
// the A5 "keep the original selection on failure" behavior); dispatch goes
// EXACTLY to the mode's backend with no silent fallback in either direction;
// backend errors (VAULT_LOCKED, VAULT_OPERATION_UNSUPPORTED, …) pass through
// untouched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import { VaultError } from '@/lib/vault/errors';
import { createSigningFacade } from '@/lib/vault/signing-facade';
import { openVaultRegistry, type VaultRegistry } from '@/lib/vault/registry';
import type {
  SignOperationsRequest,
  SignResolvedTransactionRequest,
  SigningFacade,
  VaultSigner,
} from '@/lib/vault/types';

const REQUEST: SignOperationsRequest = {
  accountName: 'alice',
  role: 'posting',
  operations: [
    ['custom_json', { required_posting_auths: ['alice'], id: 'x', json: '[]' }],
  ],
};
const RESOLVED_REQUEST: SignResolvedTransactionRequest = {
  accountName: 'alice',
  role: 'active',
  transaction: {
    ref_block_num: 1,
    ref_block_prefix: 2,
    expiration: '2030-01-01T00:00:00',
    operations: REQUEST.operations,
    extensions: [],
  },
};

function mockBackend(): { backend: VaultSigner; signOperations: ReturnType<typeof vi.fn>; signResolvedTransaction: ReturnType<typeof vi.fn> } {
  const signOperations = vi.fn();
  const signResolvedTransaction = vi.fn();
  return { backend: { signOperations, signResolvedTransaction }, signOperations, signResolvedTransaction };
}

describe('signing facade (A4)', () => {
  let fake: FakeIndexedDBHandle;
  let registry: VaultRegistry;

  beforeEach(async () => {
    fake = installFakeIndexedDB();
    registry = await openVaultRegistry();
    // Touch the settings store once so the fake database exists for wrappers.
    await registry.getSettings();
  });

  afterEach(() => {
    registry.close();
    fake.uninstall();
    fake.reset();
  });

  it('defaults to privateKey mode and round-trips setSigningMode', async () => {
    const legacy = mockBackend();
    const vault = mockBackend();
    const facade = createSigningFacade(registry, {
      vaultSigner: vault.backend,
      legacySigner: legacy.backend,
    });
    await expect(facade.getSigningMode()).resolves.toBe('privateKey');
    await facade.setSigningMode('vault');
    await expect(facade.getSigningMode()).resolves.toBe('vault');
    await facade.setSigningMode('privateKey');
    await expect(facade.getSigningMode()).resolves.toBe('privateKey');
    // Runtime garbage is a programmer error, and the stored mode survives.
    await expect(facade.setSigningMode('memo' as 'vault')).rejects.toThrow(TypeError);
    await expect(facade.getSigningMode()).resolves.toBe('privateKey');
    // The persisted row is the source of truth — a fresh facade sees it too.
    await expect(
      createSigningFacade(registry).getSigningMode(),
    ).resolves.toBe('privateKey');
  });

  it('dispatches privateKey mode to the legacy backend only', async () => {
    const legacy = mockBackend();
    const vault = mockBackend();
    legacy.signOperations.mockResolvedValue({ ok: 'legacy-operations' });
    legacy.signResolvedTransaction.mockResolvedValue({ ok: 'legacy-resolved' });
    const facade: SigningFacade = createSigningFacade(registry, {
      vaultSigner: vault.backend,
      legacySigner: legacy.backend,
    });
    await expect(facade.signOperations(REQUEST)).resolves.toEqual({ ok: 'legacy-operations' });
    await expect(facade.signResolvedTransaction(RESOLVED_REQUEST)).resolves.toEqual({
      ok: 'legacy-resolved',
    });
    expect(legacy.signOperations).toHaveBeenCalledWith(REQUEST);
    expect(legacy.signResolvedTransaction).toHaveBeenCalledWith(RESOLVED_REQUEST);
    expect(vault.signOperations).not.toHaveBeenCalled();
    expect(vault.signResolvedTransaction).not.toHaveBeenCalled();
  });

  it('dispatches vault mode to the vault backend only', async () => {
    const legacy = mockBackend();
    const vault = mockBackend();
    vault.signOperations.mockResolvedValue({ ok: 'vault-operations' });
    vault.signResolvedTransaction.mockResolvedValue({ ok: 'vault-resolved' });
    const facade = createSigningFacade(registry, {
      vaultSigner: vault.backend,
      legacySigner: legacy.backend,
    });
    await facade.setSigningMode('vault');
    await expect(facade.signOperations(REQUEST)).resolves.toEqual({ ok: 'vault-operations' });
    await expect(facade.signResolvedTransaction(RESOLVED_REQUEST)).resolves.toEqual({
      ok: 'vault-resolved',
    });
    expect(vault.signOperations).toHaveBeenCalledWith(REQUEST);
    expect(legacy.signOperations).not.toHaveBeenCalled();
    expect(legacy.signResolvedTransaction).not.toHaveBeenCalled();
  });

  it('passes VAULT_LOCKED and VAULT_OPERATION_UNSUPPORTED through untouched', async () => {
    const vault = mockBackend();
    vault.signOperations.mockRejectedValue(
      new VaultError('VAULT_LOCKED', 'no vault is unlocked in this session'),
    );
    vault.signResolvedTransaction.mockRejectedValue(
      new VaultError('VAULT_OPERATION_UNSUPPORTED', 'operation rejected: unknown type'),
    );
    const facade = createSigningFacade(registry, { vaultSigner: vault.backend });
    await facade.setSigningMode('vault');
    await expect(facade.signOperations(REQUEST)).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
    await expect(facade.signResolvedTransaction(RESOLVED_REQUEST)).rejects.toMatchObject({
      code: 'VAULT_OPERATION_UNSUPPORTED',
    });
  });

  it('fails loudly when the mode points at an unwired backend (no silent fallback)', async () => {
    const legacy = mockBackend();
    legacy.signOperations.mockResolvedValue({ ok: 'legacy' });
    // privateKey wired, vault NOT wired.
    const halfWired = createSigningFacade(registry, { legacySigner: legacy.backend });
    await halfWired.setSigningMode('vault');
    await expect(halfWired.signOperations(REQUEST)).rejects.toThrow(
      /vault signing backend was not provided/,
    );
    expect(legacy.signOperations).not.toHaveBeenCalled();
    // Vault wired, privateKey NOT wired (flip the shared mode back first —
    // the settings row is the single source of truth across facades).
    const otherWay = createSigningFacade(registry, { vaultSigner: mockBackend().backend });
    await otherWay.setSigningMode('privateKey');
    await expect(otherWay.signOperations(REQUEST)).rejects.toThrow(
      /privateKey signing backend was not provided/,
    );
  });

  it('setSigningMode failure keeps the stored mode (nothing persisted)', async () => {
    const failing: VaultRegistry = {
      ...registry,
      putSettings: () =>
        Promise.reject(new VaultError('VAULT_STORAGE_UNAVAILABLE', 'injected put failure')),
    };
    const facade = createSigningFacade(failing, {
      vaultSigner: mockBackend().backend,
      legacySigner: mockBackend().backend,
    });
    await expect(facade.setSigningMode('vault')).rejects.toMatchObject({
      code: 'VAULT_STORAGE_UNAVAILABLE',
    });
    // The real registry still reports the untouched default.
    await expect(registry.getSettings()).resolves.toMatchObject({ signingMode: 'privateKey' });
    await expect(facade.getSigningMode()).resolves.toBe('privateKey');
  });
});
