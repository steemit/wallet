/**
 * VaultError.code → i18n mapping table completeness (A5).
 *
 * The UI routes every VaultError through `vault.errors.<CODE>` — a missing
 * key in any locale would render the raw dotted key (the exact failure mode
 * the i18n-symmetry test was written for). This test pins, per locale:
 *   - the `vault.errors` key set is EXACTLY `VAULT_ERROR_CODES` (imported
 *     from src/lib/vault/types.ts — the single source of truth the
 *     `VaultErrorCode` union derives from) plus the `unexpected` fallback —
 *     a bidirectional lock: adding a code to types.ts without translating
 *     it fails here, and so does adding an i18n key with no code behind it;
 *   - all codes + the `unexpected` fallback exist with non-empty values;
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
import { VAULT_ERROR_CODES } from '@/lib/vault/types';
import type { VaultErrorCode } from '@/lib/vault/types';

// Single source of truth: the exported array types.ts derives the union
// from. No hand-maintained copy here — the lock below catches any drift.
const CODES: readonly VaultErrorCode[] = VAULT_ERROR_CODES;

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
  it('locks VAULT_ERROR_CODES and every locale table to the same key set (bidirectional)', () => {
    const expected = [...CODES, 'unexpected'].sort();
    for (const locale of Object.keys(locales)) {
      // Types gains a code without translations → missing key here; an i18n
      // key with no code behind it → extra key here. Both directions fail.
      expect(Object.keys(errorTable(locale)).sort(), `${locale}.json vault.errors`).toEqual(
        expected,
      );
    }
  });

  it('covers all codes plus the unexpected fallback with non-empty values in every locale', () => {
    for (const locale of Object.keys(locales)) {
      const errors = errorTable(locale);
      for (const key of [...CODES, 'unexpected']) {
        expect(
          errors[key],
          `${locale}.json vault.errors.${key}`,
        ).toEqual(expect.any(String));
        expect((errors[key] as string).trim(), `${locale}:${key}`).not.toBe('');
      }
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
