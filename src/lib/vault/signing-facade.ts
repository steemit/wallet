// Signing facade (A4) — the ONE dispatch surface business components call.
// It routes each signing request to the backend the persisted signing mode
// selects and nothing else: privateKey mode → the legacy signer, vault mode →
// the vault signer. NO SILENT FALLBACK in either direction — when the mode's
// backend is not wired, the call fails loudly (`TypeError`, a wiring bug)
// rather than quietly signing through the other path.
//
// MODE STATE lives in the registry's settings row (`signingMode`, default
// `'privateKey'` — the A6 acceptance "default privateKey behavior unchanged"
// starts here). `setSigningMode` persists only on success: `putSettings`
// resolves after the write, and any failure propagates with the stored mode
// untouched, so the A5 UI can keep showing the original selection.
//
// COMPOSITION (the reason backends are injected, not created here): the vault
// signer is only meaningful when it shares the unlock-session service the
// user's UI unlocks — one tab = one manager = one service. Building private
// instances inside the facade would produce a signer whose session can never
// be unlocked. Wire it at the app's composition root:
//
//   const manager = createVaultManager(registry);
//   const facade = createSigningFacade(registry, {
//     vaultSigner: manager.createSigner(),
//     legacySigner: createLegacyPrivateKeySigner(readKeyFromLoginState),
//   });
//
// Error pass-through contract: `VAULT_EMPTY` (vault mode, no vault selected
// or active), `VAULT_OPERATION_UNSUPPORTED` and every other backend error
// reach the caller untouched — the facade adds no interpretation of its own.
import type { VaultRegistry } from './registry';
import type {
  SignOperationsRequest,
  SignResolvedTransactionRequest,
  SignResult,
  SigningFacade,
  SigningMode,
  VaultSigner,
} from './types';

/** Injected signing backends; both optional so tests (and A6) wire their own. */
export interface SigningFacadeBackends {
  /** Vault-mode backend — normally `manager.createSigner()`. */
  vaultSigner?: VaultSigner;
  /** privateKey-mode backend — normally `createLegacyPrivateKeySigner(getter)`. */
  legacySigner?: VaultSigner;
}

/**
 * Build the signing facade over a registry's settings row. Without backends
 * the facade still reads/writes the mode but every signing call fails with a
 * `TypeError` naming the missing backend — that is deliberate (fail loud,
 * never fall back); the composition root is expected to wire both.
 */
export function createSigningFacade(
  registry: VaultRegistry,
  backends?: SigningFacadeBackends,
): SigningFacade {
  const vaultSigner = backends?.vaultSigner;
  const legacySigner = backends?.legacySigner;

  async function getSigningMode(): Promise<SigningMode> {
    return (await registry.getSettings()).signingMode;
  }

  async function setSigningMode(mode: SigningMode): Promise<void> {
    if (mode !== 'privateKey' && mode !== 'vault') {
      throw new TypeError('setSigningMode: mode must be privateKey or vault');
    }
    const settings = await registry.getSettings();
    // Persists only on success: a putSettings failure propagates and the
    // stored row (and therefore getSigningMode) still reports the old mode.
    await registry.putSettings({ ...settings, signingMode: mode });
  }

  function backendFor(mode: SigningMode): VaultSigner {
    if (mode === 'vault') {
      if (!vaultSigner) {
        throw new TypeError(
          'createSigningFacade: the vault signing backend was not provided (wire manager.createSigner())',
        );
      }
      return vaultSigner;
    }
    if (!legacySigner) {
      throw new TypeError(
        'createSigningFacade: the privateKey signing backend was not provided (wire createLegacyPrivateKeySigner(...))',
      );
    }
    return legacySigner;
  }

  return {
    getSigningMode,

    setSigningMode,

    async signOperations(request: SignOperationsRequest): Promise<SignResult> {
      const backend = backendFor(await getSigningMode());
      return backend.signOperations(request);
    },

    async signResolvedTransaction(request: SignResolvedTransactionRequest): Promise<SignResult> {
      const backend = backendFor(await getSigningMode());
      return backend.signResolvedTransaction(request);
    },
  };
}
