/**
 * VaultError.code → i18n mapping table completeness (A5).
 *
 * The UI routes every VaultError through `vault.errors.<CODE>` — a missing
 * key in any locale would render the raw dotted key (the exact failure mode
 * the i18n-symmetry test was written for). This test pins, per locale:
 *   - all 17 codes from src/lib/vault/types.ts + the `unexpected` fallback
 *     exist with non-empty values;
 *   - no locale renders the raw code itself as the message (catches
 *     copy-paste of codes into translations);
 *   - every code has a DISTINCT English message (catches two codes
 *     accidentally sharing one string, which would misinform users).
 */
import { describe, it, expect } from 'vitest';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import ko from '@/i18n/messages/ko.json';
import type { VaultErrorCode } from '@/lib/vault/types';

// Kept in lockstep with types.ts (VaultErrorCode union) + the `unexpected`
// fallback used by the vault UI components.
const CODES: VaultErrorCode[] = [
  'VAULT_NAME_EXISTS',
  'VAULT_NOT_FOUND',
  'VAULT_EMPTY',
  'VAULT_MODE_REQUIRED',
  'VAULT_OPERATION_UNSUPPORTED',
  'VAULT_LOCKED',
  'VAULT_PASSWORD_INVALID',
  'VAULT_ENVELOPE_INVALID',
  'VAULT_PAYLOAD_INVALID',
  'VAULT_SESSION_STALE',
  'VAULT_STORAGE_UNAVAILABLE',
  'VAULT_CRYPTO_UNAVAILABLE',
  'VAULT_NAME_INVALID',
  'VAULT_PASSWORD_WEAK',
  'VAULT_KEY_INVALID',
  'VAULT_LIMIT_EXCEEDED',
  'VAULT_AUTHORITY_UNAVAILABLE',
];

type Messages = Record<string, unknown>;

const locales: Record<string, Messages> = { en, zh, es, ko };

function errorTable(locale: string): Record<string, unknown> {
  const vault = locales[locale]?.['vault'] as Messages | undefined;
  if (!vault || typeof vault !== 'object') {
    throw new Error(`${locale}.json has no vault section`);
  }
  const errors = vault['errors'] as Record<string, unknown> | undefined;
  if (!errors || typeof errors !== 'object') {
    throw new Error(`${locale}.json has no vault.errors section`);
  }
  return errors;
}

describe('vault error i18n mapping table', () => {
  it('covers all 17 codes plus the unexpected fallback in every locale', () => {
    for (const locale of Object.keys(locales)) {
      const errors = errorTable(locale);
      const keys = [...CODES, 'unexpected'];
      for (const key of keys) {
        expect(
          errors[key],
          `${locale}.json vault.errors.${key}`,
        ).toEqual(expect.any(String));
        expect((errors[key] as string).trim(), `${locale}:${key}`).not.toBe('');
      }
      // No extra error keys that the UI would never read (keeps the table
      // exactly the code set).
      expect(Object.keys(errors).sort()).toEqual(keys.sort());
    }
  });

  it('never renders the raw code as the message in any locale', () => {
    for (const locale of Object.keys(locales)) {
      const errors = errorTable(locale);
      for (const code of [...CODES, 'unexpected']) {
        expect(errors[code], `${locale}:${code}`).not.toBe(code);
      }
    }
  });

  it('gives every code a distinct English message', () => {
    const errors = errorTable('en');
    const messages = [...CODES, 'unexpected'].map((code) => errors[code] as string);
    expect(new Set(messages).size).toBe(messages.length);
  });
});
