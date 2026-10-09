/**
 * SigningKey — what `SteemSigner.sign<Op>` methods accept for a role key.
 *
 * Every call site today passes a raw WIF string. Keychain sessions have no
 * WIF at all (the extension never exposes one to the page), so the signing
 * key becomes a tagged union: either a raw WIF (`{ type: 'wif' }`, the
 * existing behavior) or a request to sign through the Steem Keychain browser
 * extension (`{ type: 'keychain' }`).
 *
 * `sign<Op>` methods accept `SigningKey | string` so every existing raw-WIF
 * call site (including `tests/unit/steem-signer-real-ops.test.ts`) keeps
 * working unchanged — `toSigningKey` normalizes a plain string to
 * `{ type: 'wif' }` at the one chokepoint, `SteemSigner.signTransaction`.
 */

/** Authority Keychain is asked to sign with. Owner is intentionally never
 * requested here — see docs/AI-driver/02-auth.md's Keychain section for why
 * owner-authority flows stay raw-key-only. */
export type KeychainKeyRole = 'Posting' | 'Active';

export type SigningKey =
  | { type: 'wif'; wif: string }
  | { type: 'keychain'; username: string; role: KeychainKeyRole };

export function wifKey(value: string): SigningKey {
  return { type: 'wif', wif: value };
}

export function keychainKey(username: string, role: KeychainKeyRole): SigningKey {
  return { type: 'keychain', username, role };
}

export function toSigningKey(key: SigningKey | string): SigningKey {
  return typeof key === 'string' ? wifKey(key) : key;
}
