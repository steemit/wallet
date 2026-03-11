import { vi } from 'vitest';

// Mock for @steemit/steem-js
export default {
  auth: {
    signTransaction: vi.fn(),
    sign: vi.fn(),
    privateToPublic: vi.fn(),
    isWif: vi.fn(),
    signatureVerify: vi.fn(),
  },
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
