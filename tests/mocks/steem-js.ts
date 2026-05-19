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
  // verifySignature is used by SteemService.verifyChallengeSignature; default no-op (undefined)
  // so individual tests can override via mockReturnValue/mockImplementation.
  verifySignature: vi.fn(),
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
    // server.ts dynamic-cast methods. Listed here so vi.clearAllMocks() resets them
    // and tests can configure them through `vi.mocked(steem.api.xxx)` without surprise.
    callAsync: vi.fn(),
    getSavingsWithdrawToAsync: vi.fn(),
    getSavingsWithdrawFromAsync: vi.fn(),
    getOpenOrdersAsync: vi.fn(),
  },
};

export default steem;
