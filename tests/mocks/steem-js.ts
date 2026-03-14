import { vi } from 'vitest';

// Mock for @steemit/steem-js (1.0.x); client uses named import: import { steem } from '@steemit/steem-js'
const auth = {
  signTransaction: vi.fn(() => ({ signatures: ['SIG'], operations: [] })),
  sign: vi.fn(() => 'signed'),
  getPublicKey: vi.fn((wif: string) => (wif ? 'STM' + wif.slice(-8) : 'STM')),
  privateToPublic: vi.fn(),
  toWif: vi.fn(() => '5Jmock'),
  getPrivateKeys: vi.fn(() => ({ owner: '5Jo', active: '5Ja', posting: '5Jp', memo: '5Jm' })),
  isWif: vi.fn(() => true),
  signatureVerify: vi.fn(),
};

export const steem = {
  auth,
  api: {
    setOptions: vi.fn(),
    getAccountsAsync: vi.fn(),
    getAccountHistoryAsync: vi.fn(),
    getWitnessesByVoteAsync: vi.fn(),
    getWitnessByAccountAsync: vi.fn(),
    getDynamicGlobalPropertiesAsync: vi.fn(),
    getFeedHistoryAsync: vi.fn(),
    broadcastTransactionAsync: vi.fn(),
  },
};

export default steem;
