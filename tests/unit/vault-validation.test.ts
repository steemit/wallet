// Vault shared-validation tests (A1.1). Table-driven; every rejection case
// asserts both the VaultError type and the exact error code.
//
// WIF cases are MOCK-DRIVEN: under vitest, '@steemit/steem-js' is aliased to
// tests/mocks/steem-js.ts whose `isWif` always returns true and whose
// `getPublicKey` is a fake implementation. These cases therefore only prove
// the branches and error codes of validateVaultWif — NOT real WIF checksum
// validation or real public-key derivation. Real-crypto verification of the
// fixture WIFs (isWif, getPublicKey, vector public-key comparison, invalid
// inputs) lives in tests/node/vault-wif-real-check.mjs, run with plain
// `node` (the real isWif cannot run in vitest jsdom — @noble/hashes 2.x
// rejects the Node Buffers steem-js passes in; see AGENTS.md MAIN-60).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { steem } from '@steemit/steem-js';
import {
  VAULT_COMMON_PASSWORDS_V1,
  VAULT_COMMON_PASSWORDS_VERSION,
  VAULT_NAME_MAX_CODE_POINTS,
  VAULT_PASSWORD_MIN_CODE_POINTS,
  validateVaultAccountName,
  validateVaultName,
  validateVaultPassword,
  validateVaultWif,
  vaultNameComparisonKey,
} from '@/lib/vault/validation';
import { VaultError } from '@/lib/vault/errors';

function expectVaultErrorCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(VaultError);
  expect(error).toMatchObject({ code });
}

function captureCode(fn: () => unknown): { error: unknown } {
  try {
    fn();
  } catch (error) {
    return { error };
  }
  return { error: undefined };
}

describe('validateVaultName', () => {
  const accepted: Array<{ msg: string; value: unknown; stored: string }> = [
    { msg: 'plain ascii name', value: 'demo', stored: 'demo' },
    { msg: 'internal whitespace is kept', value: 'My Vault 2026', stored: 'My Vault 2026' },
    { msg: 'unicode mix', value: 'Café-工作', stored: 'Café-工作' },
    {
      msg: 'NFD input is stored as its NFC display value',
      value: 'Cafe\u0301',
      stored: 'Café',
    },
    {
      msg: 'single astral character (1 code point, 2 UTF-16 units)',
      value: '😀',
      stored: '😀',
    },
    {
      msg: 'exactly 64 astral characters (code points, not UTF-16 units)',
      value: '😀'.repeat(VAULT_NAME_MAX_CODE_POINTS),
      stored: '😀'.repeat(VAULT_NAME_MAX_CODE_POINTS),
    },
    {
      msg: 'exactly 64 BMP characters',
      value: 'a'.repeat(VAULT_NAME_MAX_CODE_POINTS),
      stored: 'a'.repeat(VAULT_NAME_MAX_CODE_POINTS),
    },
    {
      // Contrast with the lone-surrogate rejections below: a surrogate PAIR
      // is one legal astral code point (not Cs) and must keep passing now
      // that \p{Cs} is in the forbidden regex.
      msg: 'paired surrogates form a legal astral character (Cs rejects only UNPAIRED surrogates)',
      value: 'a\uD800\uDC00b',
      stored: 'a\uD800\uDC00b',
    },
    {
      // U+0344 doubles to U+0308 U+0301 under NFC: 32 raw code points
      // normalize to EXACTLY the 64-code-point ceiling — the boundary case
      // for the post-normalization re-measure.
      msg: 'combining marks whose NFC form is exactly 64 code points',
      value: '\u0344'.repeat(VAULT_NAME_MAX_CODE_POINTS / 2),
      stored: '\u0308\u0301'.repeat(VAULT_NAME_MAX_CODE_POINTS / 2),
    },
  ];

  it.each(accepted)('accepts $msg', ({ value, stored }) => {
    expect(validateVaultName(value)).toBe(stored);
  });

  const rejected: Array<{ msg: string; value: unknown }> = [
    { msg: 'empty name', value: '' },
    { msg: 'leading space', value: ' demo' },
    { msg: 'trailing space', value: 'demo ' },
    { msg: 'leading tab', value: '\tdemo' },
    { msg: 'trailing newline', value: 'demo\n' },
    { msg: 'leading NBSP (trimmed as whitespace)', value: '\u00a0demo' },
    { msg: 'trailing NBSP', value: 'demo\u00a0' },
    { msg: '65 BMP characters', value: 'a'.repeat(VAULT_NAME_MAX_CODE_POINTS + 1) },
    {
      msg: '65 astral characters (code-point count, not UTF-16 units)',
      value: '😀'.repeat(VAULT_NAME_MAX_CODE_POINTS + 1),
    },
    { msg: 'control character (Cc) inside', value: 'de\u0007mo' },
    { msg: 'C1 control character (Cc)', value: 'de\u009fmo' },
    { msg: 'zero-width space (Cf)', value: 'de\u200bmo' },
    { msg: 'soft hyphen (Cf)', value: 'de\u00admo' },
    { msg: 'byte-order mark (Cf)', value: '\ufeffdemo' },
    { msg: 'left-to-right override (Cf)', value: 'de\u202emo' },
    { msg: 'line separator (Zl)', value: 'de\u2028mo' },
    { msg: 'paragraph separator (Zp)', value: 'de\u2029mo' },
    // Lone surrogates (Cs) are invisible, survive trim and NFC untouched,
    // and can arrive via JSON.parse of an imported backup — reject them.
    { msg: 'lone high surrogate (Cs)', value: '\uD800' },
    { msg: 'lone low surrogate (Cs)', value: '\uDC00' },
    { msg: 'unpaired surrogate inside (Cs)', value: 'a\uD800b' },
    // 64 raw code points that NFC expands to 128 — the raw count passes but
    // the display value would blow the envelope layer's 64 limit.
    { msg: '64 combining marks whose NFC form is 128 code points', value: '\u0344'.repeat(64) },
    { msg: 'non-string name', value: 42 },
    { msg: 'null name', value: null },
  ];

  it.each(rejected)('rejects $msg with VAULT_NAME_INVALID', ({ value }) => {
    const { error } = captureCode(() => validateVaultName(value));
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_NAME_INVALID');
  });

  it('rejection messages never echo the name', () => {
    // 'e\u0007' and '\u0007m' span the control character, so they can only
    // appear in the message if a fragment of THIS input was echoed. A short
    // generic fragment like 'de' is too weak: it collides with ordinary
    // message wording (false reds) and barely detects real echoes.
    const secret = 'de\u0007mo';
    const { error } = captureCode(() => validateVaultName(secret));
    expect(error).toBeDefined();
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).not.toContain('e\u0007');
    expect((error as Error).message).not.toContain('\u0007m');
  });
});

describe('vaultNameComparisonKey', () => {
  it('makes Work and work collide (case-insensitive) while displays differ', () => {
    const upper: string = 'Work';
    const lower: string = 'work';
    expect(upper === lower).toBe(false);
    expect(vaultNameComparisonKey(upper)).toBe(vaultNameComparisonKey(lower));
    expect(vaultNameComparisonKey(upper)).toBe('work');
  });

  it('makes NFC and NFD Café collide while raw inputs differ', () => {
    const nfc: string = 'Café';
    const nfd: string = 'Cafe\u0301';
    expect(nfc === nfd).toBe(false);
    expect(vaultNameComparisonKey(nfc)).toBe(vaultNameComparisonKey(nfd));
    // Both inputs store as the SAME NFC display value — the key collides
    // because canonicalization collides, not because display differs.
    expect(validateVaultName(nfd)).toBe(validateVaultName(nfc));
  });

  it('does not collide distinct names', () => {
    expect(vaultNameComparisonKey('Work')).not.toBe(vaultNameComparisonKey('Vault'));
  });
});

describe('validateVaultPassword', () => {
  const LONG_OK = 'a-wonderful-long-vault-passphrase';

  it('accepts a password at exactly the minimum code-point count', () => {
    expect(() =>
      validateVaultPassword('a'.repeat(VAULT_PASSWORD_MIN_CODE_POINTS)),
    ).not.toThrow();
  });

  it('counts code points, not UTF-16 units (14 astral characters pass)', () => {
    expect(() => validateVaultPassword('😀'.repeat(VAULT_PASSWORD_MIN_CODE_POINTS))).not.toThrow();
  });

  it('rejects 13 code points with VAULT_PASSWORD_WEAK (length path)', () => {
    const { error } = captureCode(() =>
      validateVaultPassword('a'.repeat(VAULT_PASSWORD_MIN_CODE_POINTS - 1)),
    );
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_PASSWORD_WEAK');
    expect((error as Error).message).toMatch(/at least 14/);
  });

  it('rejects the short common password "password" via the LENGTH path, not the blocklist', () => {
    // 8 code points: the length rule fires first. The two rejection paths
    // must stay distinguishable — assert the message names the length rule
    // and does NOT mention the blocklist.
    const { error } = captureCode(() => validateVaultPassword('password'));
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_PASSWORD_WEAK');
    expect((error as Error).message).toMatch(/at least 14/);
    expect((error as Error).message).not.toMatch(/blocklist/);
  });

  it('rejects "correct horse battery staple" via the BLOCKLIST path (>= 14 code points)', () => {
    // 29 code points: passes the length rule and must hit the list.
    const { error } = captureCode(() => validateVaultPassword('correct horse battery staple'));
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_PASSWORD_WEAK');
    expect((error as Error).message).toMatch(/blocklist/);
    expect((error as Error).message).not.toMatch(/at least 14/);
  });

  it('blocklist comparison uses the default lowercase conversion', () => {
    const { error } = captureCode(() =>
      validateVaultPassword('Correct Horse Battery Staple'),
    );
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_PASSWORD_WEAK');
    expect((error as Error).message).toMatch(/blocklist/);
  });

  it('rejects a password equal to the normalized account name when the flow knows it', () => {
    const password = 'allyourbase-belongs2-us'; // 23 code points, not common
    const { error } = captureCode(() =>
      validateVaultPassword(password, { accountName: '@AllYourBase-Belongs2-Us ' }),
    );
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_PASSWORD_WEAK');
    expect((error as Error).message).toMatch(/account name/);
    // Without the account context the same password is fine — the
    // comparison only runs when the flow actually knows the account.
    expect(() => validateVaultPassword(password)).not.toThrow();
  });

  it('rejects a password equal to the same-flow master password, and only then', () => {
    const { error } = captureCode(() =>
      validateVaultPassword(LONG_OK, { masterPassword: LONG_OK }),
    );
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_PASSWORD_WEAK');
    expect((error as Error).message).toMatch(/master password/);
    // A different master password in the same flow does not collide…
    expect(() => validateVaultPassword(LONG_OK, { masterPassword: 'another-master-pw' })).not.toThrow();
    // …and without a master-password input the comparison never runs.
    expect(() => validateVaultPassword(LONG_OK)).not.toThrow();
  });

  it('rejects a non-string password', () => {
    const { error } = captureCode(() => validateVaultPassword(42));
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_PASSWORD_WEAK');
  });

  it('rejection messages never echo the password', () => {
    for (const [password, context] of [
      ['correct horse battery staple', undefined],
      ['allyourbase-belongs2-us', { accountName: 'allyourbase-belongs2-us' }],
      [LONG_OK, { masterPassword: LONG_OK }],
    ] as const) {
      const { error } = captureCode(() => validateVaultPassword(password, context));
      expect(error).toBeDefined();
      // Fragments are input-specific (>=10 chars unique to each password,
      // prefix AND suffix) — short generic fragments would collide with
      // ordinary message wording while detecting little.
      expect((error as Error).message).not.toContain(password);
      expect((error as Error).message).not.toContain(password.slice(0, 10));
      expect((error as Error).message).not.toContain(password.slice(-12));
    }
  });

  it('exposes the versioned common-password blocklist with all 12 kickoff entries', () => {
    expect(VAULT_COMMON_PASSWORDS_VERSION).toBe(1);
    expect(VAULT_COMMON_PASSWORDS_V1).toEqual([
      'password',
      '123456',
      '12345678',
      '123456789',
      'qwerty',
      'qwerty123',
      'letmein',
      'iloveyou',
      'admin',
      'steem',
      'steemit',
      'correct horse battery staple',
    ]);
  });
});

describe('validateVaultAccountName', () => {
  it('normalizes through the shared normalizeSteemUsername entry point', () => {
    expect(validateVaultAccountName('@Alice ')).toBe('alice');
    expect(validateVaultAccountName('Bob')).toBe('bob');
  });

  const rejected: Array<{ msg: string; value: unknown }> = [
    { msg: 'too short (2 chars)', value: 'ab' },
    { msg: 'too long (17 chars)', value: 'a'.repeat(17) },
    { msg: 'illegal characters after normalization', value: 'bad name' },
    { msg: 'underscore is not a legal account character', value: 'bad_name' },
    { msg: 'empty string', value: '' },
    { msg: 'non-string', value: 42 },
  ];

  it.each(rejected)('rejects $msg with VAULT_KEY_INVALID', ({ value }) => {
    const { error } = captureCode(() => validateVaultAccountName(value));
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_KEY_INVALID');
  });
});

describe('validateVaultWif (mock-driven — see file header)', () => {
  afterEach(() => {
    vi.mocked(steem.auth.isWif).mockReset();
    vi.mocked(steem.auth.getPublicKey).mockReset();
  });

  const WIF = '5J5Fyoy7FDUn57R7efAL9F7k5h64krJTFEoQJzbBeQqQEhD3jpx';

  it('returns the normalized account name and the derived public key', () => {
    // Explicit stubs (not the vi.fn defaults) so the case stays green under
    // shuffled/repeated runs regardless of mockReset semantics.
    vi.mocked(steem.auth.isWif).mockReturnValue(true);
    vi.mocked(steem.auth.getPublicKey).mockReturnValue('STM7mockPublicKeyOnce');
    expect(validateVaultWif(WIF, '@Alice ')).toEqual({
      accountName: 'alice',
      publicKey: 'STM7mockPublicKeyOnce',
    });
    expect(steem.auth.isWif).toHaveBeenCalledWith(WIF);
    expect(steem.auth.getPublicKey).toHaveBeenCalledWith(WIF);
  });

  it('rejects with VAULT_KEY_INVALID when isWif reports an invalid WIF', () => {
    vi.mocked(steem.auth.isWif).mockReturnValueOnce(false);
    const { error } = captureCode(() => validateVaultWif(WIF, 'alice'));
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_KEY_INVALID');
    expect((error as Error).message).not.toContain(WIF);
    // 12-char random-base58 fragments (prefix AND suffix) are unique to this
    // WIF and cannot collide with English message wording.
    expect((error as Error).message).not.toContain(WIF.slice(0, 12));
    expect((error as Error).message).not.toContain(WIF.slice(-12));
  });

  it('rejects with VAULT_KEY_INVALID when public key derivation throws', () => {
    vi.mocked(steem.auth.getPublicKey).mockImplementationOnce(() => {
      throw new Error('derivation boom');
    });
    const { error } = captureCode(() => validateVaultWif(WIF, 'alice'));
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_KEY_INVALID');
  });

  it.each([
    { msg: 'empty string', key: '' },
    { msg: 'bare STM prefix', key: 'STM' },
    { msg: 'non-string', key: 42 },
  ])('rejects a derived public key that is $msg', ({ key }) => {
    vi.mocked(steem.auth.getPublicKey).mockReturnValueOnce(key as string);
    const { error } = captureCode(() => validateVaultWif(WIF, 'alice'));
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_KEY_INVALID');
  });

  it('rejects an invalid account association before touching the WIF', () => {
    const { error } = captureCode(() => validateVaultWif(WIF, 'not a valid name'));
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_KEY_INVALID');
    // The account check runs first — the (expensive, sensitive) WIF path is
    // never reached for a garbage account name.
    expect(steem.auth.isWif).not.toHaveBeenCalled();
    expect(steem.auth.getPublicKey).not.toHaveBeenCalled();
  });

  it('rejects a non-string WIF with VAULT_KEY_INVALID', () => {
    const { error } = captureCode(() => validateVaultWif(42, 'alice'));
    expect(error).toBeDefined();
    expectVaultErrorCode(error, 'VAULT_KEY_INVALID');
  });
});
