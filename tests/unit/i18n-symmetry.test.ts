/**
 * i18n locale symmetry guard (finding G-8 / Theme I).
 *
 * en/zh/es message files must define identical key sets with non-empty
 * string values. The repo has no other automated check: es.json shipped
 * missing keys whose `t()` call sites lacked a `defaultMessage` fallback,
 * rendering raw dotted keys to Spanish users, and dead keys accumulated in
 * all three locales at once (so a plain en-vs-es diff never flagged them).
 *
 * This test fails on:
 *  - any key present in one locale but missing from another (reports the
 *    exact missing keys per locale pair),
 *  - any non-string or empty/whitespace-only value.
 *
 * Removing a key legitimately? Remove it from ALL THREE files in the same
 * commit. Adding one? Add it to all three (or at minimum en + one more, run
 * this test, and let it list exactly what the other locale still needs).
 */
import { describe, it, expect } from 'vitest';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';

type Messages = Record<string, unknown>;

const locales: Record<string, Messages> = { en, zh, es };

/** Flatten nested message objects into dotted key -> leaf value. */
function flatten(obj: Messages, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Messages, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

const flattened: Record<string, Record<string, unknown>> = {};
for (const [locale, messages] of Object.entries(locales)) {
  flattened[locale] = flatten(messages);
}

function diffKeys(reference: string, target: string): { missing: string[]; extra: string[] } {
  const refKeys = Object.keys(flattened[reference] ?? {});
  const targetKeys = new Set(Object.keys(flattened[target] ?? {}));
  return {
    missing: refKeys.filter((key) => !targetKeys.has(key)),
    extra: [...targetKeys].filter((key) => !refKeys.includes(key)),
  };
}

describe('i18n message symmetry', () => {
  it('en, zh, es define identical key sets', () => {
    for (const target of ['zh', 'es']) {
      const { missing, extra } = diffKeys('en', target);
      if (missing.length > 0 || extra.length > 0) {
        const detail = [
          missing.length > 0
            ? `missing from ${target}: ${missing.join(', ')}`
            : null,
          extra.length > 0
            ? `extra in ${target} (not in en): ${extra.join(', ')}`
            : null,
        ]
          .filter(Boolean)
          .join('; ');
        throw new Error(
          `${target}.json key set diverges from en.json — ${detail}. ` +
            'Keep all three locales symmetric in the same commit ' +
            '(see tests/unit/i18n-symmetry.test.ts).'
        );
      }
      expect(missing).toEqual([]);
      expect(extra).toEqual([]);
    }
  });

  it('every message value is a non-empty string (or list of them)', () => {
    // `t.raw()` list values (wallet.permissions.*PermissionItems) are arrays;
    // everything else must be a plain non-empty string.
    const offenders: string[] = [];
    for (const [locale, flat] of Object.entries(flattened)) {
      for (const [key, value] of Object.entries(flat)) {
        if (Array.isArray(value)) {
          const items = value.filter(
            (item) => typeof item === 'string' && item.trim() !== ''
          );
          if (value.length === 0 || items.length !== value.length) {
            offenders.push(`${locale}: ${key} (list with empty/non-string items)`);
          }
        } else if (typeof value !== 'string' || value.trim() === '') {
          offenders.push(`${locale}: ${key} (${JSON.stringify(value)})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('locale files are non-trivial (guards against an accidental wipe)', () => {
    for (const [locale, flat] of Object.entries(flattened)) {
      expect(Object.keys(flat).length, `${locale}.json key count`).toBeGreaterThan(100);
    }
  });
});
