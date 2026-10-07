/**
 * Guard test: every operation SteemSigner builds must survive the REAL
 * @steemit/steem-js serializer.
 *
 * Why this file exists: the whole suite aliases '@steemit/steem-js' to
 * tests/mocks/steem-js.ts, whose `auth.signTransaction` is a `vi.fn()` that
 * returns a canned payload. Everything downstream of signing therefore passes
 * even when the installed library cannot serialize the operation the UI just
 * built — the throw only happens in a browser, after the user has authenticated
 * and unlocked a key. That is precisely how delegation / revoke-delegation and
 * the proposal actions broke on @steemit/steem-js 1.2.0 and 1.2.1: the op-index
 * map listed six operation types whose serializer case was never written, so
 * signing threw `Operation type <x> serialization not fully implemented`.
 *
 * This file loads the real published package (the same ESM entry a browser
 * bundle resolves), signs one transaction per operation SteemSigner exposes with
 * a genuinely derived WIF, and verifies the resulting signature against the
 * signer's public key. A serialization gap inside the library fails here, at
 * build time, naming the operation — instead of failing a user's click.
 *
 * Keep this in lockstep with the dependency: it is red on any library version
 * missing a serializer, so it must move together with the version bump.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pathToFileURL } from 'node:url';

// Re-point the suite-wide alias at the real package. The mock file is never
// loaded for this module graph; the factory below supplies the real ESM
// namespace (which is what `import { steem } from '@steemit/steem-js'` in
// src/lib/steem/client.ts then receives).
//
// Load dist/browser.esm.js — the entry Next's client build resolves through the
// package's "browser" condition, i.e. the bundle a user's browser actually runs.
// (The node ESM entry dist/index.js cannot run under jsdom at all: its `Buffer`
// and the jsdom realm's `Uint8Array` are different realms, so @noble/hashes
// rejects the buffers it builds. That mismatch is a test-environment artifact,
// not a shipping path — the browser bundle gives the production code path and
// works here.)
vi.mock('@steemit/steem-js', async () => {
  const entry = pathToFileURL(
    `${process.cwd()}/node_modules/@steemit/steem-js/dist/browser.esm.js`
  ).href;
  return await import(/* @vite-ignore */ entry);
});

import { steem } from '@steemit/steem-js';
import { SteemSigner } from '@/lib/steem/client';
import type { SignedTransaction } from '@/lib/steem/types';

// The mock's declared types describe the stub, not the real module — assert the
// shape this file actually needs.
const realAuth = steem.auth as unknown as {
  toWif(account: string, password: string, role: string): string;
  getPublicKey(wif: string): string;
  verifyTransaction(transaction: unknown, publicKey: string): boolean;
};

const ACCOUNT = 'wallet-signer-guard';
const MASTER_PASSWORD = 'P5KwalletSignerGuardMaster';
const OLD_PASSWORD = `${MASTER_PASSWORD}-old`;
const NEW_PASSWORD = `${MASTER_PASSWORD}-new`;

const activeKey = realAuth.toWif(ACCOUNT, MASTER_PASSWORD, 'active');
const postingKey = realAuth.toWif(ACCOUNT, MASTER_PASSWORD, 'posting');
const ownerKey = realAuth.toWif(ACCOUNT, MASTER_PASSWORD, 'owner');
const activePublicKey = realAuth.getPublicKey(activeKey);
const postingPublicKey = realAuth.getPublicKey(postingKey);
const ownerPublicKey = realAuth.getPublicKey(ownerKey);
const oldOwnerPublicKey = realAuth.getPublicKey(
  realAuth.toWif(ACCOUNT, OLD_PASSWORD, 'owner')
);

function authority(publicKey: string) {
  return {
    weight_threshold: 1,
    account_auths: [] as [string, number][],
    key_auths: [[publicKey, 1]] as [string, number][],
  };
}

type SignerCase = {
  /** SteemSigner method under test (used by the coverage assertion below). */
  method: string;
  /** Chain operation type the method is expected to produce. */
  operationType: string;
  /** Public key matching the WIF the method signs with. */
  publicKey: string;
  sign: () => Promise<SignedTransaction>;
};

const cases: SignerCase[] = [
  {
    method: 'signTransfer',
    operationType: 'transfer',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signTransfer(ACCOUNT, 'bob', '1.000 STEEM', 'memo', activeKey),
  },
  {
    method: 'signTransferToSavings',
    operationType: 'transfer_to_savings',
    publicKey: activePublicKey,
    sign: () =>
      SteemSigner.signTransferToSavings(ACCOUNT, ACCOUNT, '1.000 STEEM', '', activeKey),
  },
  {
    method: 'signTransferFromSavings',
    operationType: 'transfer_from_savings',
    publicKey: activePublicKey,
    sign: () =>
      SteemSigner.signTransferFromSavings(ACCOUNT, ACCOUNT, '1.000 STEEM', 'm', 42, activeKey),
  },
  {
    method: 'signTransferToVesting',
    operationType: 'transfer_to_vesting',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signTransferToVesting(ACCOUNT, ACCOUNT, '5.000 STEEM', activeKey),
  },
  {
    method: 'signPowerDown',
    operationType: 'withdraw_vesting',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signPowerDown(ACCOUNT, '100.000000 VESTS', activeKey),
  },
  {
    method: 'signDelegate',
    operationType: 'delegate_vesting_shares',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signDelegate(ACCOUNT, 'bob', '100.000000 VESTS', activeKey),
  },
  {
    // Revoking a delegation is the same operation with zero VESTS — the path the
    // reported failure came from.
    method: 'signDelegate',
    operationType: 'delegate_vesting_shares',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signDelegate(ACCOUNT, 'bob', '0.000000 VESTS', activeKey),
  },
  {
    method: 'signWitnessVote',
    operationType: 'account_witness_vote',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signWitnessVote(ACCOUNT, 'witness1', true, activeKey),
  },
  {
    method: 'signWitnessProxy',
    operationType: 'account_witness_proxy',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signWitnessProxy(ACCOUNT, 'witness1', activeKey),
  },
  {
    method: 'signUpdateProposalVotes',
    operationType: 'update_proposal_votes',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signUpdateProposalVotes(ACCOUNT, [42, 7], true, activeKey),
  },
  {
    method: 'signCreateProposal',
    operationType: 'create_proposal',
    publicKey: activePublicKey,
    sign: () =>
      SteemSigner.signCreateProposal(
        ACCOUNT,
        'bob',
        '2026-01-01T00:00:00',
        '2026-02-01T00:00:00',
        '10.000 SBD',
        'subject',
        'permlink',
        activeKey
      ),
  },
  {
    method: 'signRemoveProposal',
    operationType: 'remove_proposal',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signRemoveProposal(ACCOUNT, [42], activeKey),
  },
  {
    method: 'signSetWithdrawVestingRoute',
    operationType: 'set_withdraw_vesting_route',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signSetWithdrawVestingRoute(ACCOUNT, 'bob', 5000, true, activeKey),
  },
  {
    method: 'signConvert',
    operationType: 'convert',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signConvert(ACCOUNT, 1710000000, '10.500 SBD', activeKey),
  },
  {
    method: 'signClaimRewardBalance',
    operationType: 'claim_reward_balance',
    publicKey: postingPublicKey,
    sign: () =>
      SteemSigner.signClaimRewardBalance(
        ACCOUNT,
        '0.000 STEEM',
        '1.500 SBD',
        '123.456789 VESTS',
        postingKey
      ),
  },
  {
    method: 'signChangeRecoveryAccount',
    operationType: 'change_recovery_account',
    publicKey: ownerPublicKey,
    sign: () => SteemSigner.signChangeRecoveryAccount(ACCOUNT, 'recovery1', ownerKey),
  },
  {
    method: 'signCancelTransferFromSavings',
    operationType: 'cancel_transfer_from_savings',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signCancelTransferFromSavings(ACCOUNT, 42, activeKey),
  },
  {
    method: 'signLimitOrderCreate',
    operationType: 'limit_order_create',
    publicKey: activePublicKey,
    sign: () =>
      SteemSigner.signLimitOrderCreate(
        ACCOUNT,
        '1.000 SBD',
        '2.000 STEEM',
        12345,
        1710000000,
        activeKey
      ),
  },
  {
    method: 'signLimitOrderCancel',
    operationType: 'limit_order_cancel',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signLimitOrderCancel(ACCOUNT, 12345, activeKey),
  },
  {
    method: 'signAccountCreate',
    operationType: 'account_create',
    publicKey: activePublicKey,
    sign: () => SteemSigner.signAccountCreate(ACCOUNT, 'hive-123456', 'Psecret', activeKey),
  },
  {
    method: 'signAccountUpdate',
    operationType: 'account_update',
    publicKey: ownerPublicKey,
    sign: () =>
      SteemSigner.signAccountUpdate(
        [
          'account_update',
          {
            account: ACCOUNT,
            owner: authority(ownerPublicKey),
            active: authority(activePublicKey),
            posting: authority(postingPublicKey),
            memo_key: postingPublicKey,
            json_metadata: '{}',
          },
        ],
        ownerKey
      ),
  },
  {
    method: 'signRecoverAccount',
    operationType: 'recover_account',
    publicKey: oldOwnerPublicKey,
    sign: async () =>
      (await SteemSigner.signRecoverAccount(ACCOUNT, OLD_PASSWORD, NEW_PASSWORD)).signedTx,
  },
  {
    method: 'signOperations',
    operationType: 'custom_json',
    publicKey: postingPublicKey,
    sign: () =>
      SteemSigner.signOperations(
        [['custom_json', { required_posting_auths: [ACCOUNT], id: 'community', json: '[]' }]],
        [postingKey]
      ),
  },
];

// One header response for every case: shape copied from
// /api/query/transaction-header (see tests/unit/steem-client.test.ts).
const TRANSACTION_HEADER = {
  success: true,
  ref_block_num: 99,
  ref_block_prefix: 3704360964,
  expiration: '2030-01-01T12:00:00',
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      json: async () => TRANSACTION_HEADER,
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SteemSigner operations sign through the real @steemit/steem-js', () => {
  it.each(cases)(
    '$method -> $operationType is serialized, signed and verifies',
    async ({ sign, operationType, publicKey }) => {
      const signed = await sign();

      // The library returns the operations it serialized; a wrong op shape here
      // means the wallet built something other than what it claims.
      expect(signed.operations[0]?.[0]).toBe(operationType);

      expect(signed.signatures).toHaveLength(1);
      const [signature] = signed.signatures;
      // Encoding-agnostic (the library emits the raw signature in the form its
      // bundle normalizes to); the real proof is the crypto round-trip below.
      expect((signature ?? '').length).toBeGreaterThanOrEqual(64);

      // Real crypto round-trip over the real serializer: this is what a node
      // does before accepting the transaction, so a byte-level mistake in the
      // library's serializer fails here too.
      expect(realAuth.verifyTransaction(signed, publicKey)).toBe(true);
    }
  );

  it('covers every transaction-signing method on SteemSigner', () => {
    // signTransaction is the primitive every case above funnels through;
    // signChallenge signs a login challenge string, not a transaction.
    const covered = new Set([
      'signTransaction',
      'signChallenge',
      ...cases.map((c) => c.method),
    ]);

    const uncovered = Object.getOwnPropertyNames(SteemSigner).filter(
      (name) => /^sign[A-Z]/.test(name) && !covered.has(name)
    );

    expect(uncovered).toEqual([]);
  });
});
