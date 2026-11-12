import { describe, expect, it } from 'vitest';

import { validateVaultEnvelope } from '@/lib/vault/envelope';
import type { VaultEnvelopeV1 } from '@/lib/vault/types';

// Per-key field pin (with the OPTIONAL outer publicKey, 2026-11-13): a key
// entry is `iv / ciphertext / note` plus an optional `publicKey` string —
// entries written before the field existed stay valid without it.
const hierarchical = {
  version: 1,
  vaultName: 'work',
  salt: 'AAECAwQFBgcICQoLDA0ODw',
  accounts: [
    {
      accountName: 'alice',
      keys: {
        owner: [],
        active: [],
        posting: [
          {
            iv: 'EBESExQVFhcYGRob',
            ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA',
            note: 'desktop posting key',
            publicKey: 'STM7Y3tmCZvomT2NKZvWNEmBdEQaiViaysPNc1LRrxc88bUvNQuGu',
          },
        ],
        memo: [],
      },
    },
  ],
} satisfies VaultEnvelopeV1;

const hierarchicalLegacy = {
  version: 1,
  vaultName: 'work',
  salt: 'AAECAwQFBgcICQoLDA0ODw',
  accounts: [
    {
      accountName: 'alice',
      keys: {
        owner: [],
        active: [],
        posting: [
          {
            iv: 'EBESExQVFhcYGRob',
            ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA',
            note: 'desktop posting key',
          },
        ],
        memo: [],
      },
    },
  ],
} satisfies VaultEnvelopeV1;

describe('R1 hierarchical vault contract', () => {
  it('accepts per-key ciphertext and public notes under the four-field root', () => {
    const result = validateVaultEnvelope(hierarchical);
    expect(result.accounts[0]?.keys.posting[0]?.note).toBe('desktop posting key');
    expect(Object.keys(result).sort()).toEqual(['accounts', 'salt', 'vaultName', 'version']);
  });

  it('carries the optional outer publicKey verbatim and accepts legacy entries without it', () => {
    const withField = validateVaultEnvelope(hierarchical);
    expect(withField.accounts[0]?.keys.posting[0]?.publicKey).toBe(
      'STM7Y3tmCZvomT2NKZvWNEmBdEQaiViaysPNc1LRrxc88bUvNQuGu',
    );
    const legacy = validateVaultEnvelope(hierarchicalLegacy);
    expect(legacy.accounts[0]?.keys.posting[0]).toEqual({
      iv: 'EBESExQVFhcYGRob',
      ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA',
      note: 'desktop posting key',
    });
    expect('publicKey' in (legacy.accounts[0]?.keys.posting[0] ?? {})).toBe(false);
  });

  it('rejects the retired whole-payload envelope instead of maintaining a parallel format', () => {
    expect(() =>
      validateVaultEnvelope({
        version: 1,
        vaultName: 'work',
        salt: hierarchical.salt,
        iv: 'EBESExQVFhcYGRob',
        ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA',
      }),
    ).toThrow();
  });
});
