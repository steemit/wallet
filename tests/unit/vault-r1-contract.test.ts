import { describe, expect, it } from 'vitest';

import { validateVaultEnvelope } from '@/lib/vault/envelope';
import type { VaultEnvelopeV1 } from '@/lib/vault/types';

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
