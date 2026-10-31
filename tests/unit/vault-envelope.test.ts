// Vault envelope + payload validation tests (A1). Table-driven; every
// rejection case asserts both the VaultError type and the exact error code.
// Base64url strings for off-spec lengths are derived by truncating the
// fixture strings so their decoded lengths are provable (chars*6/8 bits).
import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { VAULT_IV_BYTES, VAULT_SALT_BYTES } from '@/lib/vault/crypto';
import {
  VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES,
  VAULT_ENVELOPE_CIPHERTEXT_MIN_BYTES,
  VAULT_ENVELOPE_IV_BYTES,
  VAULT_ENVELOPE_NAME_MAX_LENGTH,
  VAULT_ENVELOPE_SALT_BYTES,
  decodeBase64Url,
  encodeBase64Url,
  validateVaultEnvelope,
  validateVaultPayloadText,
} from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';
import type { VaultEnvelopeV1 } from '@/lib/vault/types';

const v = vectors.vault;

const VALID_ENVELOPE: VaultEnvelopeV1 = {
  version: 1,
  vaultName: 'demo',
  salt: v.salt,
  iv: v.iv,
  ciphertext: v.ciphertext,
};

function without(field: keyof VaultEnvelopeV1): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...VALID_ENVELOPE };
  delete copy[field];
  return copy;
}

function expectVaultErrorCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(VaultError);
  expect(error).toMatchObject({ code });
}

async function expectRejectedBy(validate: () => unknown, code: string): Promise<void> {
  // Keep the "did not reject" failure OUT of this helper's own try/catch, so
  // a passing validator reports as a missing rejection instead of surfacing
  // indirectly as a failed VaultError assertion on the unreachable marker.
  let result: unknown;
  try {
    result = await validate();
  } catch (error) {
    expectVaultErrorCode(error, code);
    return;
  }
  expect.unreachable(`expected the validator to reject with ${code}, got result: ${String(result)}`);
}

describe('base64url helpers', () => {
  it('re-encodes the fixture salt/iv/ciphertext bytes to the exact fixture strings', () => {
    expect(encodeBase64Url(decodeBase64Url(v.salt))).toBe(v.salt);
    expect(encodeBase64Url(decodeBase64Url(v.iv))).toBe(v.iv);
    expect(encodeBase64Url(decodeBase64Url(v.ciphertext))).toBe(v.ciphertext);
  });

  it('round-trips arbitrary byte lengths', () => {
    for (const length of [0, 1, 2, 3, 15, 16, 17, 31, 32, 118, 134, 255]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        bytes[i] = (i * 37 + 11) % 256;
      }
      expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('encodes empty input as the empty string and decodes it back', () => {
    expect(encodeBase64Url(new Uint8Array(0))).toBe('');
    expect(decodeBase64Url('')).toEqual(new Uint8Array(0));
  });

  it.each([
    { msg: "standard base64 '+'", value: 'AAECAwQ+' },
    { msg: "standard base64 '/'", value: 'AAECAwQ/' },
    { msg: "'=' padding", value: 'AAECAwQ=' },
    { msg: "'==' padding", value: 'AAECAw==' },
    { msg: 'embedded whitespace', value: 'AAECAwQ ' },
    { msg: 'impossible length (1 char)', value: 'A' },
    { msg: 'impossible length (5 chars)', value: 'AAAAA' },
    { msg: 'non-string input', value: 42 },
  ])('decode rejects $msg', ({ value }) => {
    expect(() => decodeBase64Url(value as string)).toThrow();
  });
});

describe('cross-module constant consistency (envelope.ts vs crypto.ts)', () => {
  // salt/IV/tag byte lengths are defined in BOTH envelope.ts (validation) and
  // crypto.ts (generation) and coupled only by comments; these assertions make
  // any drift between the two modules an immediate test failure.
  it('envelope field length constants match the crypto profile', () => {
    expect(VAULT_ENVELOPE_SALT_BYTES).toBe(VAULT_SALT_BYTES);
    expect(VAULT_ENVELOPE_IV_BYTES).toBe(VAULT_IV_BYTES);
    // 16 bytes = the GCM 128-bit authentication tag appended to every
    // ciphertext (Web Crypto's native output format); a bare tag over zero
    // plaintext bytes is the shortest structurally valid ciphertext.
    expect(VAULT_ENVELOPE_CIPHERTEXT_MIN_BYTES).toBe(16);
  });
});

describe('vault envelope validation', () => {
  it('accepts a valid five-field envelope and returns it as a plain object', () => {
    const result = validateVaultEnvelope(VALID_ENVELOPE);
    expect(result).toEqual(VALID_ENVELOPE);
    expect(Object.keys(result).sort()).toEqual(['ciphertext', 'iv', 'salt', 'vaultName', 'version']);
  });

  it('accepts a unicode vault name and one at the length cap', () => {
    expect(validateVaultEnvelope({ ...VALID_ENVELOPE, vaultName: 'Café-工作' })).toEqual({
      ...VALID_ENVELOPE,
      vaultName: 'Café-工作',
    });
    const capped = validateVaultEnvelope({
      ...VALID_ENVELOPE,
      vaultName: 'a'.repeat(VAULT_ENVELOPE_NAME_MAX_LENGTH),
    });
    expect(capped.vaultName).toHaveLength(VAULT_ENVELOPE_NAME_MAX_LENGTH);
  });

  const rejections: Array<{ msg: string; value: unknown }> = [
    // Unknown versions fail closed.
    { msg: 'version 2', value: { ...VALID_ENVELOPE, version: 2 } },
    { msg: 'version 0', value: { ...VALID_ENVELOPE, version: 0 } },
    { msg: 'version as string "1"', value: { ...VALID_ENVELOPE, version: '1' } },
    { msg: 'version null', value: { ...VALID_ENVELOPE, version: null } },
    { msg: 'missing version', value: without('version') },
    // vaultName
    { msg: 'empty vaultName', value: { ...VALID_ENVELOPE, vaultName: '' } },
    { msg: 'over-long vaultName', value: { ...VALID_ENVELOPE, vaultName: 'a'.repeat(65) } },
    { msg: 'non-string vaultName', value: { ...VALID_ENVELOPE, vaultName: 42 } },
    { msg: 'missing vaultName', value: without('vaultName') },
    // salt: 22-char base64url = 16 bytes; 20 chars = 15 bytes; 23 chars = 17 bytes.
    { msg: 'salt decoding to 15 bytes', value: { ...VALID_ENVELOPE, salt: 'AAECAwQFBgcICQoLDA0OD' } },
    { msg: 'salt decoding to 17 bytes', value: { ...VALID_ENVELOPE, salt: 'AAECAwQFBgcICQoLDA0ODwA' } },
    { msg: "salt with '+'", value: { ...VALID_ENVELOPE, salt: '+AECAwQFBgcICQoLDA0ODw' } },
    { msg: "salt with '/'", value: { ...VALID_ENVELOPE, salt: '/AECAwQFBgcICQoLDA0ODw' } },
    { msg: "salt with '=' padding", value: { ...VALID_ENVELOPE, salt: 'AAECAwQFBgcICQoLDA0ODw=' } },
    { msg: 'empty salt', value: { ...VALID_ENVELOPE, salt: '' } },
    { msg: 'non-string salt', value: { ...VALID_ENVELOPE, salt: 42 } },
    { msg: 'missing salt', value: without('salt') },
    // iv: 16-char base64url = 12 bytes; 15 chars = 11 bytes; 18 chars = 13 bytes.
    { msg: 'iv decoding to 11 bytes', value: { ...VALID_ENVELOPE, iv: 'EBESExQVFhcYGRo' } },
    { msg: 'iv decoding to 13 bytes', value: { ...VALID_ENVELOPE, iv: 'EBESExQVFhcYGRobAB' } },
    { msg: "iv with '=' padding", value: { ...VALID_ENVELOPE, iv: 'EBESExQVFhcYGRob=' } },
    { msg: 'non-string iv', value: { ...VALID_ENVELOPE, iv: 42 } },
    { msg: 'missing iv', value: without('iv') },
    // ciphertext: at least 16 decoded bytes (GCM tag); 20 chars = 15 bytes.
    { msg: 'ciphertext decoding to 15 bytes', value: { ...VALID_ENVELOPE, ciphertext: v.ciphertext.slice(0, 20) } },
    { msg: "ciphertext with '+'", value: { ...VALID_ENVELOPE, ciphertext: `+${v.ciphertext.slice(1)}` } },
    { msg: 'empty ciphertext', value: { ...VALID_ENVELOPE, ciphertext: '' } },
    { msg: 'non-string ciphertext', value: { ...VALID_ENVELOPE, ciphertext: 42 } },
    { msg: 'missing ciphertext', value: without('ciphertext') },
    // Shape problems around the five fields.
    { msg: 'extra field (revision)', value: { ...VALID_ENVELOPE, revision: 1 } },
    { msg: 'null envelope', value: null },
    { msg: 'string envelope', value: JSON.stringify(VALID_ENVELOPE) },
    { msg: 'array envelope', value: [VALID_ENVELOPE] },
    { msg: 'number envelope', value: 42 },
  ];

  it.each(rejections)('rejects $msg with VAULT_ENVELOPE_INVALID', async ({ value }) => {
    await expectRejectedBy(() => validateVaultEnvelope(value), 'VAULT_ENVELOPE_INVALID');
  });

  it('rejects a ciphertext above the 1 MiB cap and accepts one exactly at it', async () => {
    // Oversized by a single byte must reject — no real encryption involved,
    // the cap guards the decode/allocate step inside validation itself.
    const oversized = encodeBase64Url(new Uint8Array(VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES + 1));
    await expectRejectedBy(
      () => validateVaultEnvelope({ ...VALID_ENVELOPE, ciphertext: oversized }),
      'VAULT_ENVELOPE_INVALID',
    );
    // Exactly at the cap is structurally valid (validation never decrypts).
    const atCap = encodeBase64Url(new Uint8Array(VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES));
    expect(() => validateVaultEnvelope({ ...VALID_ENVELOPE, ciphertext: atCap })).not.toThrow();
  });

  it('rejection messages never echo envelope field values', () => {
    const cases: unknown[] = [
      { ...VALID_ENVELOPE, ciphertext: v.ciphertext.slice(0, 20) },
      { ...VALID_ENVELOPE, salt: '+AECAwQFBgcICQoLDA0ODw' },
      { ...VALID_ENVELOPE, version: 2 },
    ];
    for (const bad of cases) {
      try {
        validateVaultEnvelope(bad);
        expect.unreachable('expected the validator to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError);
        const message = (error as Error).message;
        expect(message).not.toContain(v.ciphertext);
        expect(message).not.toContain(v.ciphertext.slice(0, 20));
        expect(message).not.toContain(v.salt);
        expect(message).not.toContain('AAECAwQFBgcICQoLDA0OD');
      }
    }
  });
});

describe('vault payload validation', () => {
  it('accepts the fixture payload text', () => {
    expect(validateVaultPayloadText(v.payloadText)).toEqual(v.payload);
  });

  it('accepts an empty key list', () => {
    expect(validateVaultPayloadText('{"keys":[]}')).toEqual({ keys: [] });
  });

  const rejections: Array<{ msg: string; value: string }> = [
    { msg: 'non-JSON text', value: 'not json at all' },
    { msg: 'empty text', value: '' },
    { msg: 'JSON null', value: 'null' },
    { msg: 'JSON array', value: '[]' },
    { msg: 'JSON string', value: '"just a string"' },
    { msg: 'JSON number', value: '123' },
    { msg: 'JSON boolean', value: 'true' },
    { msg: 'missing keys field', value: '{}' },
    { msg: 'keys as object', value: '{"keys":{}}' },
    { msg: 'keys as string', value: '{"keys":"alice"}' },
    { msg: 'keys as null', value: '{"keys":null}' },
    { msg: 'extra top-level field', value: '{"keys":[],"extra":1}' },
    { msg: 'entry missing privateKey', value: `{"keys":[{"accountName":"alice","role":"posting"}]}` },
    { msg: 'entry missing accountName', value: `{"keys":[{"role":"posting","privateKey":"5Jt"}]}` },
    { msg: 'entry missing role', value: `{"keys":[{"accountName":"alice","privateKey":"5Jt"}]}` },
    { msg: 'illegal role', value: `{"keys":[{"accountName":"alice","role":"admin","privateKey":"5Jt"}]}` },
    { msg: 'non-string privateKey', value: `{"keys":[{"accountName":"alice","role":"posting","privateKey":42}]}` },
    { msg: 'non-string accountName', value: `{"keys":[{"accountName":42,"role":"posting","privateKey":"5Jt"}]}` },
    { msg: 'entry as null', value: '{"keys":[null]}' },
    { msg: 'entry as string', value: '{"keys":["alice"]}' },
    { msg: 'empty accountName', value: `{"keys":[{"accountName":"","role":"posting","privateKey":"5Jt"}]}` },
    { msg: 'empty privateKey', value: `{"keys":[{"accountName":"alice","role":"posting","privateKey":""}]}` },
    {
      msg: 'extra entry field',
      value: '{"keys":[{"accountName":"alice","role":"posting","privateKey":"5Jt","note":"x"}]}',
    },
  ];

  it.each(rejections)('rejects $msg with VAULT_PAYLOAD_INVALID', async ({ value }) => {
    await expectRejectedBy(() => validateVaultPayloadText(value), 'VAULT_PAYLOAD_INVALID');
  });

  it('rejects non-string payload text input', async () => {
    await expectRejectedBy(
      () => validateVaultPayloadText(42 as unknown as string),
      'VAULT_PAYLOAD_INVALID',
    );
  });

  it('rejection messages never contain payload key material', () => {
    // Invalid JSON that still embeds the fixture WIF.
    const bad = v.payloadText.slice(0, -1);
    try {
      validateVaultPayloadText(bad);
      expect.unreachable('expected the validator to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultError);
      expect((error as Error).message).not.toContain('5J5Fyoy7FDUn57R7');
    }
  });
});
