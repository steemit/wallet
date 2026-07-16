import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { vi } from 'vitest';

// Vitest aliases @steemit/steem-js to this file; load real auth helpers from node_modules.
const realSteemJsPath = path.resolve(
  process.cwd(),
  'node_modules/@steemit/steem-js/dist/index.js'
);
const realSteemJs = await import(pathToFileURL(realSteemJsPath).href);
const realAuth = realSteemJs.steem.auth;

// Mock for @steemit/steem-js (1.0.x); client uses named import: import { steem } from '@steemit/steem-js'
const auth = {
  normalizeOperationForBroadcast: realAuth.normalizeOperationForBroadcast,
  normalizeTransactionForBroadcast: realAuth.normalizeTransactionForBroadcast,
  normalizeChainJsonMetadata: realAuth.normalizeChainJsonMetadata,
  sanitizeAccountUpdatePayload: realAuth.sanitizeAccountUpdatePayload,
  resolveAuthorityForSerialize: realAuth.resolveAuthorityForSerialize,
  normalizeAuthoritySource: realAuth.normalizeAuthoritySource,
  signTransaction: vi.fn(() => ({ signatures: ['SIG'], operations: [] })),
  sign: vi.fn(() => 'signed'),
  getPublicKey: vi.fn((wif: string) => (wif ? 'STM' + wif.slice(-8) : 'STM')),
  privateToPublic: vi.fn(),
  toWif: vi.fn(() => '5Jmock'),
  wifToPublic: vi.fn(() => 'STMmockPublicKey'),
  getPrivateKey: vi.fn(() => '5JrandomOwnerWif'),
  getPrivateKeys: vi.fn(() => ({ owner: '5Jo', active: '5Ja', posting: '5Jp', memo: '5Jm' })),
  isWif: vi.fn(() => true),
  signatureVerify: vi.fn(),
  // verifySignature is used by SteemService.verifyChallengeSignature; default no-op (undefined)
  // so individual tests can override via mockReturnValue/mockImplementation.
  verifySignature: vi.fn(),
  // verifyTransaction (v1.0.20+): real crypto signature verification. Proxy to
  // the real implementation so tests exercise actual sign/verify round-trips.
  verifyTransaction: realAuth.verifyTransaction,
  // serializeTransaction (v1.0.20+): real binary serializer, proxied for tests.
  serializeTransaction: realAuth.serializeTransaction,
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
    getBlockAsync: vi.fn(),
    getBlockHeaderAsync: vi.fn(),
  },
};

export default steem;
