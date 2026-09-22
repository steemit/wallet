/**
 * Route-handler tests for the 12 broadcast routes that previously had zero
 * route-level coverage (2026-09-21 review finding J-2 remainder).
 *
 * Covered here: account-create, account-update, convert, custom-json,
 * delegate, limit-order-cancel, limit-order-create, power-down,
 * proposal-vote, set-withdraw-vesting-route, witness-proxy, witness-vote.
 * (The other 7 are covered by transfer-broadcast-route.test.ts,
 * proposals-broadcast-routes.test.ts, recovery-*-route.test.ts and
 * change-recovery-account / cancel-transfer-from-savings / claim-reward
 * route tests — see docs/AI-driver/03-broadcast.md.)
 *
 * The shared runner follows the transfer gold standard (CSRF first, rate
 * limit, shape rejection, unchanged relay, uniform audit log) and pins EACH
 * route's post-broadcast cache-invalidation contract individually: exact
 * prefixes (user-scoped ones derived from the REAL hashedUserCachePrefix,
 * not invented strings), exact call count, and exact call order. This is the
 * anti-copy-paste-drift guard for exactly the routes where invalidation
 * drift historically grew (witness votes deleting withdraw-routes etc.).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { steem } from '@steemit/steem-js';
import { hashedUserCachePrefix } from '@/lib/cache/cache-key';

const mockVerifyCSRF = vi.fn();
const mockRateLimit = vi.fn();
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: (...args: unknown[]) => mockVerifyCSRF(...args),
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockValidateTransactionShape = vi.fn();
const mockBroadcastTransaction = vi.fn();
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    validateTransactionShape: (...args: unknown[]) => mockValidateTransactionShape(...args),
    broadcastTransaction: (...args: unknown[]) => mockBroadcastTransaction(...args),
  },
}));

const mockCacheDeleteByPrefix = vi.fn();
vi.mock('@/lib/cache/redis', () => ({
  cacheDeleteByPrefix: (...args: unknown[]) => mockCacheDeleteByPrefix(...args),
}));

import { POST as POST_ACCOUNT_CREATE } from '@/app/api/broadcast/account-create/route';
import { POST as POST_ACCOUNT_UPDATE } from '@/app/api/broadcast/account-update/route';
import { POST as POST_CONVERT } from '@/app/api/broadcast/convert/route';
import { POST as POST_CUSTOM_JSON } from '@/app/api/broadcast/custom-json/route';
import { POST as POST_DELEGATE } from '@/app/api/broadcast/delegate/route';
import { POST as POST_LIMIT_ORDER_CANCEL } from '@/app/api/broadcast/limit-order-cancel/route';
import { POST as POST_LIMIT_ORDER_CREATE } from '@/app/api/broadcast/limit-order-create/route';
import { POST as POST_POWER_DOWN } from '@/app/api/broadcast/power-down/route';
import { POST as POST_PROPOSAL_VOTE } from '@/app/api/broadcast/proposal-vote/route';
import { POST as POST_SET_WITHDRAW_VESTING_ROUTE } from '@/app/api/broadcast/set-withdraw-vesting-route/route';
import { POST as POST_WITNESS_PROXY } from '@/app/api/broadcast/witness-proxy/route';
import { POST as POST_WITNESS_VOTE } from '@/app/api/broadcast/witness-vote/route';

const USERNAME = 'alice';

type FixtureTx = { signatures: string[]; operations: [string, unknown][]; extensions: unknown[] };

function tx(opType: string, payload: unknown = {}): FixtureTx {
  return { signatures: ['sig'], operations: [[opType, payload]], extensions: [] };
}

/**
 * Full protocol-shaped account_update payload. The account-update route runs
 * the REAL normalizeTransactionForBroadcast (via the steem-js test alias) and
 * the REAL validateAccountUpdateSignedTx before relaying, so the fixture must
 * satisfy the real sanitizers (authorities with non-empty STM key_auths).
 */
const ACCOUNT_UPDATE_TX = tx('account_update', {
  account: USERNAME,
  owner: {
    weight_threshold: 1,
    account_auths: [],
    key_auths: [['STM8GC13v3WdWmTCVnMCbAgDTx8Fqc6JK6eUz7S5hCpnTfXFnEPPi', 1]],
  },
  active: {
    weight_threshold: 1,
    account_auths: [],
    key_auths: [['STM7swWsaFdZw7thCzKEDdrC6UQcHptuGUiP4tLx2iXmsBjeBbsGC', 1]],
  },
  posting: {
    weight_threshold: 1,
    account_auths: [],
    key_auths: [['STM6Fj2sr9fQq7sdjRDEvKyXvYHP8AybclQTG6f9kT9PejBNXUqeZ', 1]],
  },
  memo_key: 'STM6Fj2sr9fQq7sdjRDEvKyXvYHP8AybclQTG6f9kT9PejBNXUqeZ',
  json_metadata: '',
});

interface RouteCase {
  /** Route name as used in URLs and audit log lines. */
  route: string;
  handler: (request: never) => Promise<Response>;
  /** Chain op type of the fixture tx (also the op= value of the audit line). */
  opType: string;
  fixtureTx: FixtureTx;
  /**
   * The object the route must hand to broadcastTransaction. Omit for the 11
   * pure relays (tx relayed UNCHANGED); account-update relays the normalized
   * copy produced by the REAL steem.auth.normalizeTransactionForBroadcast.
   */
  expectedBroadcastArg?: unknown;
  /**
   * EXACT ordered cacheDeleteByPrefix arguments after a successful relay
   * (empty = the route must not touch any cache). User-scoped prefixes are
   * derived from the real hashedUserCachePrefix so the expectation can never
   * drift from the actual key construction.
   */
  expectedDeletes: string[];
}

const h = (prefix: string) => hashedUserCachePrefix(prefix, USERNAME);

const ROUTE_CASES: RouteCase[] = [
  {
    route: 'account-create',
    handler: POST_ACCOUNT_CREATE,
    opType: 'account_create',
    fixtureTx: tx('account_create', {
      creator: USERNAME,
      new_account_name: 'bob',
      owner: ACCOUNT_UPDATE_TX.operations[0]?.[1],
      active: {},
      posting: {},
      memo_key: 'STM6test',
      json_metadata: '',
    }),
    expectedDeletes: ['cache:query:accounts'],
  },
  {
    route: 'account-update',
    handler: POST_ACCOUNT_UPDATE,
    opType: 'account_update',
    fixtureTx: ACCOUNT_UPDATE_TX,
    // Derived from the real normalizer, not hand-written (mock-contract rule).
    expectedBroadcastArg: steem.auth.normalizeTransactionForBroadcast(
      ACCOUNT_UPDATE_TX as never
    ),
    expectedDeletes: ['cache:query:accounts'],
  },
  {
    route: 'convert',
    handler: POST_CONVERT,
    opType: 'convert',
    fixtureTx: tx('convert', { owner: USERNAME, requestid: 1, amount: '1.000 SBD' }),
    expectedDeletes: ['cache:query:accounts', h('cache:query:wallet-estimate-extras')],
  },
  {
    route: 'custom-json',
    handler: POST_CUSTOM_JSON,
    opType: 'custom_json',
    fixtureTx: tx('custom_json', {
      required_auths: [USERNAME],
      required_posting_auths: [],
      id: 'follow',
      json: '["follow",{"follower":"alice","following":"bob"}]',
    }),
    // custom_json affects none of the query caches — zero deletes is the
    // contract (and must not silently regress into an accounts flush).
    expectedDeletes: [],
  },
  {
    route: 'delegate',
    handler: POST_DELEGATE,
    opType: 'delegate_vesting_shares',
    fixtureTx: tx('delegate_vesting_shares', {
      delegator: USERNAME,
      delegatee: 'bob',
      vesting_shares: '1.000000 VESTS',
    }),
    expectedDeletes: [
      'cache:query:accounts',
      h('cache:query:vesting-delegations'),
      h('cache:query:expiring-vesting-delegations'),
    ],
  },
  {
    route: 'limit-order-cancel',
    handler: POST_LIMIT_ORDER_CANCEL,
    opType: 'limit_order_cancel',
    fixtureTx: tx('limit_order_cancel', { owner: USERNAME, orderid: 7 }),
    expectedDeletes: [
      'cache:query:accounts',
      h('cache:query:wallet-estimate-extras'),
      'cache:query:market',
    ],
  },
  {
    route: 'limit-order-create',
    handler: POST_LIMIT_ORDER_CREATE,
    opType: 'limit_order_create',
    fixtureTx: tx('limit_order_create', {
      owner: USERNAME,
      orderid: 8,
      amount_to_sell: '1.000 STEEM',
      min_to_receive: '0.300 SBD',
      fill_or_kill: false,
      expiration: '2027-01-01T00:00:00',
    }),
    expectedDeletes: [
      'cache:query:accounts',
      h('cache:query:wallet-estimate-extras'),
      'cache:query:market',
    ],
  },
  {
    route: 'power-down',
    handler: POST_POWER_DOWN,
    opType: 'withdraw_vesting',
    fixtureTx: tx('withdraw_vesting', { account: USERNAME, vesting_shares: '1.000000 VESTS' }),
    expectedDeletes: ['cache:query:accounts', h('cache:query:wallet-estimate-extras')],
  },
  {
    route: 'proposal-vote',
    handler: POST_PROPOSAL_VOTE,
    opType: 'update_proposal_votes',
    fixtureTx: tx('update_proposal_votes', { voter: USERNAME, proposal_ids: [7], approve: true }),
    // Proposal votes change the proposals list only — the wallet-extras
    // delete was the historical copy-paste drift this suite pins out.
    expectedDeletes: ['cache:query:proposals'],
  },
  {
    route: 'set-withdraw-vesting-route',
    handler: POST_SET_WITHDRAW_VESTING_ROUTE,
    opType: 'set_withdraw_vesting_route',
    fixtureTx: tx('set_withdraw_vesting_route', {
      from_account: USERNAME,
      to_account: 'bob',
      percent: 10000,
      auto_vest: true,
    }),
    expectedDeletes: ['cache:query:accounts', h('cache:query:withdraw-routes')],
  },
  {
    route: 'witness-proxy',
    handler: POST_WITNESS_PROXY,
    opType: 'account_witness_proxy',
    fixtureTx: tx('account_witness_proxy', { account: USERNAME, proxy: 'bob' }),
    expectedDeletes: ['cache:query:accounts', 'cache:query:witnesses'],
  },
  {
    route: 'witness-vote',
    handler: POST_WITNESS_VOTE,
    opType: 'account_witness_vote',
    fixtureTx: tx('account_witness_vote', { account: USERNAME, witness: 'bob', approve: true }),
    // Witness votes change the account + witness list — NOT wallet extras or
    // withdraw-routes (the historical drift).
    expectedDeletes: ['cache:query:accounts', 'cache:query:witnesses'],
  },
];

/**
 * Cast pattern from the transfer gold standard: routes take NextRequest but
 * only use the standard Request surface here (mocked CSRF/limiter never
 * touch headers), so the runtime shape is a plain Request.
 */
function makeRequest(route: string, body: Record<string, unknown>): never {
  return new Request(`http://test/api/broadcast/${route}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never;
}

describe('broadcast relay routes — shared handler contract (J-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyCSRF.mockResolvedValue(null);
    mockRateLimit.mockResolvedValue(null);
    mockValidateTransactionShape.mockReturnValue(true);
    mockBroadcastTransaction.mockResolvedValue({
      id: 'trx',
      block_num: 1,
      trx_num: 1,
      expired: false,
    });
    mockCacheDeleteByPrefix.mockResolvedValue(undefined);
  });

  it.each(ROUTE_CASES.map((c) => [c.route, c] as const))(
    '%s: relays the tx, deletes exactly its own prefixes, emits the audit line',
    async (_route, c) => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      try {
        const res = await c.handler(makeRequest(c.route, { signedTx: c.fixtureTx, username: USERNAME }));

        expect(res.status).toBe(200);
        const body = (await res.json()) as { success?: boolean };
        expect(body.success).toBe(true);

        // Relay: the tx reaches broadcastTransaction UNCHANGED (pure relays)
        // or as the real normalizer's output (account-update).
        expect(mockBroadcastTransaction).toHaveBeenCalledTimes(1);
        expect(mockBroadcastTransaction).toHaveBeenCalledWith(c.expectedBroadcastArg ?? c.fixtureTx);

        // Invalidation contract, asserted per route: exact args, exact count,
        // exact order — no more, no less.
        expect(mockCacheDeleteByPrefix).toHaveBeenCalledTimes(c.expectedDeletes.length);
        c.expectedDeletes.forEach((prefix, i) => {
          expect(mockCacheDeleteByPrefix).toHaveBeenNthCalledWith(i + 1, prefix);
        });

        // #353 audit contract: one uniform success line per relay.
        expect(infoSpy).toHaveBeenCalledTimes(1);
        expect(infoSpy).toHaveBeenCalledWith(
          `Broadcast succeeded: op=${c.opType} route=${c.route} account=${USERNAME} tx_id=trx block=1`
        );
      } finally {
        infoSpy.mockRestore();
      }
    }
  );

  it.each(ROUTE_CASES.map((c) => [c.route, c] as const))(
    '%s: 403 and no relay when CSRF rejects (before rate limiting)',
    async (_route, c) => {
      mockVerifyCSRF.mockResolvedValue(new Response('csrf', { status: 403 }));

      const res = await c.handler(makeRequest(c.route, { signedTx: c.fixtureTx, username: USERNAME }));

      expect(res.status).toBe(403);
      // CSRF always runs first — the limiter must never see a rejected request.
      expect(mockRateLimit).not.toHaveBeenCalled();
      expect(mockBroadcastTransaction).not.toHaveBeenCalled();
      expect(mockCacheDeleteByPrefix).not.toHaveBeenCalled();
    }
  );

  it.each(ROUTE_CASES.map((c) => [c.route, c] as const))(
    '%s: passes the request through the broadcast rate-limit scope (429 case)',
    async (_route, c) => {
      mockRateLimit.mockResolvedValue(new Response('rl', { status: 429 }));

      const request = makeRequest(c.route, { signedTx: c.fixtureTx, username: USERNAME });
      const res = await c.handler(request);

      expect(res.status).toBe(429);
      // Every relay route uses the UNIFORM broadcast bucket (10/min) — no
      // per-operation differentiation (2026-08-15 relay decision).
      expect(mockRateLimit).toHaveBeenCalledTimes(1);
      expect(mockRateLimit).toHaveBeenCalledWith(request, 'broadcast', {
        maxRequests: 10,
        windowSeconds: 60,
      });
      expect(mockBroadcastTransaction).not.toHaveBeenCalled();
    }
  );

  it.each(ROUTE_CASES.map((c) => [c.route, c] as const))(
    '%s: 400 when body is missing signedTx or username',
    async (_route, c) => {
      const res = await c.handler(makeRequest(c.route, {}));
      expect(res.status).toBe(400);
      expect(mockBroadcastTransaction).not.toHaveBeenCalled();
      expect(mockCacheDeleteByPrefix).not.toHaveBeenCalled();
    }
  );

  it.each(ROUTE_CASES.map((c) => [c.route, c] as const))(
    '%s: 400 on malformed tx shape, before any upstream call or cache write',
    async (_route, c) => {
      mockValidateTransactionShape.mockReturnValue(false);

      const res = await c.handler(
        makeRequest(c.route, {
          signedTx: { signatures: [], operations: [], extensions: [] },
          username: USERNAME,
        })
      );

      expect(res.status).toBe(400);
      expect(mockValidateTransactionShape).toHaveBeenCalledTimes(1);
      expect(mockBroadcastTransaction).not.toHaveBeenCalled();
      expect(mockCacheDeleteByPrefix).not.toHaveBeenCalled();
    }
  );

  it.each(ROUTE_CASES.map((c) => [c.route, c] as const))(
    '%s: 500 with the uniform failure audit when the relay throws',
    async (_route, c) => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const boom = new Error('upstream exploded');
        mockBroadcastTransaction.mockRejectedValue(boom);

        const res = await c.handler(makeRequest(c.route, { signedTx: c.fixtureTx, username: USERNAME }));

        expect(res.status).toBe(500);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toBe('Failed to broadcast transaction');
        expect(errorSpy).toHaveBeenCalledWith(`Broadcast failed: route=${c.route}`, boom);
        // A failed relay must not run cache invalidation.
        expect(mockCacheDeleteByPrefix).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    }
  );
});

describe('POST /api/broadcast/account-update — relay-specific shape validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyCSRF.mockResolvedValue(null);
    mockRateLimit.mockResolvedValue(null);
    mockValidateTransactionShape.mockReturnValue(true);
    mockBroadcastTransaction.mockResolvedValue({
      id: 'trx',
      block_num: 1,
      trx_num: 1,
      expired: false,
    });
    mockCacheDeleteByPrefix.mockResolvedValue(undefined);
  });

  it('400 with details when the first operation is not account_update (real validator)', async () => {
    // account-update is the one route with extra content-shape validation
    // (it rebuilds authorities before relay). The REAL
    // validateAccountUpdateSignedTx runs (not mocked) — the fixture passes the
    // generic shape check but fails the op-type check.
    const notAccountUpdate = tx('transfer', { from: USERNAME, to: 'bob' });

    const res = await POST_ACCOUNT_UPDATE(
      makeRequest('account-update', { signedTx: notAccountUpdate, username: USERNAME })
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; details?: string };
    expect(body.error).toBe('Invalid account_update transaction');
    expect(body.details).toBe('first operation must be account_update');
    expect(mockBroadcastTransaction).not.toHaveBeenCalled();
  });

  it('never relays an account_update payload that fails real sanitization', async () => {
    // An owner authority without key_auths is rejected by the REAL
    // steem.auth.sanitizeAccountUpdatePayload. Ordering note (pinned as-is):
    // the route calls normalizeTransactionForBroadcast BEFORE
    // validateAccountUpdateSignedTx, and normalize throws on this input, so
    // the outer catch answers 500 — the validator's graceful 400+details only
    // covers cases normalize passes through (e.g. the op-type check above).
    // Either way the load-bearing property holds: nothing is broadcast.
    const badPayload = tx('account_update', {
      account: USERNAME,
      owner: { weight_threshold: 1, account_auths: [], key_auths: [] },
      active: { weight_threshold: 1, account_auths: [], key_auths: [] },
      posting: { weight_threshold: 1, account_auths: [], key_auths: [] },
      memo_key: 'STM6test',
      json_metadata: '',
    });

    const res = await POST_ACCOUNT_UPDATE(
      makeRequest('account-update', { signedTx: badPayload, username: USERNAME })
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('Failed to broadcast transaction');
    expect(mockBroadcastTransaction).not.toHaveBeenCalled();
    expect(mockCacheDeleteByPrefix).not.toHaveBeenCalled();
  });
});
