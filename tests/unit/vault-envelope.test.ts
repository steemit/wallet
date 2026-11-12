import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { VAULT_IV_BYTES, VAULT_SALT_BYTES } from '@/lib/vault/crypto';
import {
  VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES,
  VAULT_ENVELOPE_CIPHERTEXT_MAX_CHARS,
  VAULT_ENVELOPE_CIPHERTEXT_MIN_BYTES,
  VAULT_ENVELOPE_IV_BYTES,
  VAULT_ENVELOPE_JSON_MAX_BYTES,
  VAULT_ENVELOPE_MAX_ACCOUNTS,
  VAULT_ENVELOPE_MAX_KEYS,
  VAULT_ENVELOPE_SALT_BYTES,
  decodeBase64Url,
  encodeBase64Url,
  parseVaultEnvelopeJson,
  validateVaultEnvelope,
} from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';
import type { VaultAccountEntry, VaultEnvelopeV1, VaultKeyCiphertext } from '@/lib/vault/types';

const v = vectors.vault;
// JSON imports widen `version` to number — pin the literal for the V1 type.
const VALID: VaultEnvelopeV1 = { ...v.envelope, version: 1 };

function encryptedKey(index = 0, note = 'public note'): VaultKeyCiphertext {
  const bytes = new Uint8Array(12);
  new DataView(bytes.buffer).setUint32(8, index);
  return { iv: encodeBase64Url(bytes), ciphertext: 'A'.repeat(22), note };
}

function account(name = 'alice', keys: VaultKeyCiphertext[] = []): VaultAccountEntry {
  return { accountName: name, keys: { owner: [], active: [], posting: keys, memo: [] } };
}

function envelopeWithAccounts(accounts: VaultAccountEntry[]): VaultEnvelopeV1 {
  return { version: 1, vaultName: 'work', salt: v.salt, accounts };
}

async function expectCode(fn: () => unknown, code: string): Promise<void> {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(VaultError);
  expect((caught as VaultError).code).toBe(code);
}

describe('base64url helpers and constants', () => {
  it('round-trips bytes and only emits canonical unpadded base64url', () => {
    for (const length of [0, 1, 2, 3, 12, 16, 17, 67, 255]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
    }
    for (const key of v.keys) {
      expect(encodeBase64Url(decodeBase64Url(key.iv))).toBe(key.iv);
      expect(encodeBase64Url(decodeBase64Url(key.ciphertext))).toBe(key.ciphertext);
    }
  });

  it.each(['AAECAwQ+', 'AAECAwQ/', 'AAECAwQ=', 'A', 'AAAAA', 'AA EC']) (
    'rejects invalid base64url %s',
    (value) => expect(() => decodeBase64Url(value)).toThrow(),
  );

  it('keeps crypto and validation sizes aligned', () => {
    expect(VAULT_ENVELOPE_SALT_BYTES).toBe(VAULT_SALT_BYTES);
    expect(VAULT_ENVELOPE_IV_BYTES).toBe(VAULT_IV_BYTES);
    expect(VAULT_ENVELOPE_CIPHERTEXT_MIN_BYTES).toBe(16);
    expect(VAULT_ENVELOPE_CIPHERTEXT_MAX_CHARS).toBe(
      Math.ceil((VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES * 8) / 6),
    );
  });
});

describe('hierarchical V1 envelope validation', () => {
  it('accepts the fixture and returns a fresh plain structure', () => {
    const result = validateVaultEnvelope(VALID);
    expect(result).toEqual(VALID);
    expect(result).not.toBe(VALID);
    expect(result.accounts[0]).not.toBe(VALID.accounts[0]);
    expect(result.accounts[0]?.keys.posting[0]?.note).toBe('desktop posting key');
  });

  it('accepts empty accounts and public empty/unicode notes', () => {
    expect(validateVaultEnvelope(v.emptyEnvelope)).toEqual(v.emptyEnvelope);
    const value = envelopeWithAccounts([account('alice', [encryptedKey(1, ''), encryptedKey(2, '公开 😀')])]);
    expect(validateVaultEnvelope(value).accounts[0]?.keys.posting.map((key) => key.note)).toEqual([
      '',
      '公开 😀',
    ]);
  });

  const rootRejections: unknown[] = [
    null,
    [],
    'json',
    { ...VALID, version: 2 },
    { ...VALID, vaultName: '' },
    { ...VALID, vaultName: 'a'.repeat(65) },
    { ...VALID, salt: '' },
    { ...VALID, salt: 'AAECAwQFBgcICQoLDA0ODx' },
    { ...VALID, accounts: {} },
    { ...VALID, iv: v.keys[0]?.iv },
    { version: 1, vaultName: 'work', salt: v.salt },
    { version: 1, vaultName: 'work', salt: v.salt, iv: v.keys[0]?.iv, ciphertext: 'A'.repeat(22) },
  ];
  it.each(rootRejections)('rejects an invalid root with VAULT_ENVELOPE_INVALID', async (value) => {
    await expectCode(() => validateVaultEnvelope(value), 'VAULT_ENVELOPE_INVALID');
  });

  it('requires unique normalized accounts and exactly four role arrays', async () => {
    await expectCode(
      () => validateVaultEnvelope(envelopeWithAccounts([account('Alice'), account('alice')])),
      'VAULT_ENVELOPE_INVALID',
    );
    await expectCode(
      () => validateVaultEnvelope(envelopeWithAccounts([account('not valid!')])),
      'VAULT_ENVELOPE_INVALID',
    );
    const missingRole = account('alice', [encryptedKey()]);
    const keys = missingRole.keys as unknown as Record<string, unknown>;
    delete keys['memo'];
    await expectCode(
      () => validateVaultEnvelope(envelopeWithAccounts([missingRole])),
      'VAULT_ENVELOPE_INVALID',
    );
    const extraRole = account('alice');
    (extraRole.keys as unknown as Record<string, unknown>)['admin'] = [];
    await expectCode(
      () => validateVaultEnvelope(envelopeWithAccounts([extraRole])),
      'VAULT_ENVELOPE_INVALID',
    );
  });

  it('validates every key field, canonical encoding and per-vault IV uniqueness', async () => {
    const key = encryptedKey();
    const invalidKeys: unknown[] = [
      { ...key, iv: 'A' },
      { ...key, iv: 'EBESExQVFhcYGRo' },
      { ...key, ciphertext: '' },
      { ...key, ciphertext: 'A'.repeat(20) },
      { ...key, note: 42 },
      { iv: key.iv, ciphertext: key.ciphertext },
      { ...key, privateKey: '5Jsecret' },
    ];
    for (const invalid of invalidKeys) {
      await expectCode(
        () => validateVaultEnvelope(envelopeWithAccounts([account('alice', [invalid as VaultKeyCiphertext])])),
        'VAULT_ENVELOPE_INVALID',
      );
    }
    await expectCode(
      () => validateVaultEnvelope(envelopeWithAccounts([account('alice', [key, { ...key }])])),
      'VAULT_ENVELOPE_INVALID',
    );
  });

  it('treats key publicKey as optional outer data: present/absent pass, junk is rejected', async () => {
    // Present: a non-empty string is preserved verbatim (format truth is the
    // add/import path's job, not the envelope's).
    const declared = 'STM7Y3tmCZvomT2NKZvWNEmBdEQaiViaysPNc1LRrxc88bUvNQuGu';
    const withKey = envelopeWithAccounts([
      account('alice', [{ ...encryptedKey(1), publicKey: declared }]),
    ]);
    const validated = validateVaultEnvelope(withKey);
    expect(validated.accounts[0]?.keys.posting[0]?.publicKey).toBe(declared);
    // Absent: legacy entries keep validating and stay field-free.
    const withoutKey = validateVaultEnvelope(
      envelopeWithAccounts([account('alice', [encryptedKey(2)])]),
    );
    expect(withoutKey.accounts[0]?.keys.posting[0]?.publicKey).toBeUndefined();
    expect('publicKey' in (withoutKey.accounts[0]?.keys.posting[0] ?? {})).toBe(false);
    // Junk: empty string, non-strings and unknown extra fields all reject.
    const junkKeys: unknown[] = [
      { ...encryptedKey(3), publicKey: '' },
      { ...encryptedKey(4), publicKey: 42 },
      { ...encryptedKey(5), publicKey: null },
      { ...encryptedKey(6), publicKey: declared, extra: 'nope' },
    ];
    for (const junk of junkKeys) {
      await expectCode(
        () => validateVaultEnvelope(envelopeWithAccounts([account('alice', [junk as VaultKeyCiphertext])])),
        'VAULT_ENVELOPE_INVALID',
      );
    }
  });

  it('does not echo sensitive or public field values in errors', async () => {
    const bad = envelopeWithAccounts([account('alice', [{ ...encryptedKey(), note: 42 as unknown as string }])]);
    let caught: unknown;
    try {
      validateVaultEnvelope(bad);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).not.toContain(v.keys[0]?.ciphertext ?? 'missing');
    expect((caught as Error).message).not.toContain('5Jsecret');
  });
});

describe('envelope resource limits and raw JSON gate', () => {
  it('accepts exactly 400 keys and rejects 401', async () => {
    const atCap = envelopeWithAccounts([
      account('alice', Array.from({ length: VAULT_ENVELOPE_MAX_KEYS }, (_, i) => encryptedKey(i))),
    ]);
    expect(validateVaultEnvelope(atCap).accounts[0]?.keys.posting).toHaveLength(400);
    const over = envelopeWithAccounts([
      account('alice', Array.from({ length: VAULT_ENVELOPE_MAX_KEYS + 1 }, (_, i) => encryptedKey(i))),
    ]);
    await expectCode(() => validateVaultEnvelope(over), 'VAULT_LIMIT_EXCEEDED');
  });

  it('accepts exactly 100 accounts and rejects 101', async () => {
    const atCap = envelopeWithAccounts(
      Array.from({ length: VAULT_ENVELOPE_MAX_ACCOUNTS }, (_, i) => account(`user${String(i).padStart(3, '0')}`)),
    );
    expect(validateVaultEnvelope(atCap.accounts ? atCap : atCap).accounts).toHaveLength(100);
    const over = envelopeWithAccounts(
      Array.from({ length: VAULT_ENVELOPE_MAX_ACCOUNTS + 1 }, (_, i) => account(`user${String(i).padStart(3, '0')}`)),
    );
    await expectCode(() => validateVaultEnvelope(over), 'VAULT_LIMIT_EXCEEDED');
  });

  it('bounds ciphertext before decoding and total UTF-8 size', async () => {
    const huge = envelopeWithAccounts([
      account('alice', [{ ...encryptedKey(), ciphertext: 'A'.repeat(VAULT_ENVELOPE_CIPHERTEXT_MAX_CHARS + 1) }]),
    ]);
    await expectCode(() => validateVaultEnvelope(huge), 'VAULT_LIMIT_EXCEEDED');
    const bigNote = envelopeWithAccounts([
      account('alice', [encryptedKey(1, 'é'.repeat(600000))]),
    ]);
    await expectCode(() => validateVaultEnvelope(bigNote), 'VAULT_LIMIT_EXCEEDED');
  });

  it('parses valid JSON, accepts exact-size input and rejects oversized or invalid input', async () => {
    const json = JSON.stringify(VALID);
    expect(parseVaultEnvelopeJson(json)).toEqual(VALID);
    const padded = ' '.repeat(VAULT_ENVELOPE_JSON_MAX_BYTES - json.length) + json;
    expect(parseVaultEnvelopeJson(padded)).toEqual(VALID);
    await expectCode(() => parseVaultEnvelopeJson(`${padded} `), 'VAULT_LIMIT_EXCEEDED');
    await expectCode(() => parseVaultEnvelopeJson('not json'), 'VAULT_ENVELOPE_INVALID');
    await expectCode(() => parseVaultEnvelopeJson('{"keys":[]}'), 'VAULT_ENVELOPE_INVALID');
    await expectCode(
      () => parseVaultEnvelopeJson(42 as unknown as string),
      'VAULT_ENVELOPE_INVALID',
    );
  });
});
