import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock middleware — CSRF/rate limiting are passthrough security layers; their
// own behavior is covered by csrf.test.ts / rate-limit-*.test.ts. Here we pin
// that the login route wires them (order + passthrough) and nothing else.
const mockVerifyCSRF = vi.fn();
const mockRateLimit = vi.fn();
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: (...args: unknown[]) => mockVerifyCSRF(...args),
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

// Mock SteemService — signature verification and account lookup are stubbed;
// the route's own logic (fail-closed, one-time consume, key attribution) is
// what these tests pin. collectOverseer is fire-and-forget on the success path.
const mockVerifyChallengeSignature = vi.fn();
const mockGetAccounts = vi.fn();
const mockCollectOverseer = vi.fn();
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    verifyChallengeSignature: (...args: unknown[]) => mockVerifyChallengeSignature(...args),
    getAccounts: (...args: unknown[]) => mockGetAccounts(...args),
    collectOverseer: (...args: unknown[]) => mockCollectOverseer(...args),
  },
}));

// Mock the Redis singleton (repo convention: singletons are mocked, not real).
const mockRedisGet = vi.fn();
const mockRedisGetdel = vi.fn();
const mockGetRedis = vi.fn();
vi.mock('@/lib/cache/redis', () => ({
  getRedis: () => mockGetRedis(),
  redisKey: (k: string) => `wallet:${k}`,
}));

import { POST } from '@/app/api/auth/login/route';

const STORED = JSON.stringify({
  challenge: 'login-alice-challenge',
  createdAt: Date.now(),
});

function accountFixture() {
  return {
    name: 'alice',
    balance: '10.000 STEEM',
    sbd_balance: '2.000 SBD',
    vesting_shares: '1000.000000 VESTS',
    active: { key_auths: [['STMactive', 1]] },
    posting: { key_auths: [['STMposting', 1]] },
    owner: { key_auths: [['STMowner', 1]] },
    memo_key: 'STMmemo',
  };
}

function makeRequest(body: string | Record<string, unknown>): NextRequest {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    username: 'alice',
    signedChallenge: 'sig-alice',
    publicKey: 'STMposting',
    ...overrides,
  };
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyCSRF.mockResolvedValue(null);
    mockRateLimit.mockResolvedValue(null);
    mockGetRedis.mockReturnValue({ get: mockRedisGet, getdel: mockRedisGetdel });
    mockRedisGet.mockResolvedValue(STORED);
    // GETDEL returns the consumed value for the winner.
    mockRedisGetdel.mockResolvedValue(STORED);
    mockVerifyChallengeSignature.mockReturnValue(true);
    mockGetAccounts.mockResolvedValue([accountFixture()]);
    mockCollectOverseer.mockResolvedValue(undefined);
  });

  it('logs in successfully and returns the account payload', async () => {
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.username).toBe('alice');
    expect(data.publicKey).toBe('STMposting');
    expect(data.account).toEqual({
      name: 'alice',
      balance: '10.000 STEEM',
      sbd_balance: '2.000 SBD',
      vesting_shares: '1000.000000 VESTS',
    });
  });

  it('verifies the signature against the STORED challenge, not the request', async () => {
    await POST(makeRequest(validBody()));
    expect(mockVerifyChallengeSignature).toHaveBeenCalledWith(
      'login-alice-challenge',
      'sig-alice',
      'STMposting'
    );
  });

  it('wires CSRF before rate limit before body parsing', async () => {
    await POST(makeRequest(validBody()));
    expect(mockVerifyCSRF).toHaveBeenCalledTimes(1);
    expect(mockRateLimit).toHaveBeenCalledWith(expect.anything(), 'login', {
      maxRequests: 10,
      windowSeconds: 60,
    });
  });

  it('passes the CSRF rejection through (403, nothing else runs)', async () => {
    const { NextResponse } = await import('next/server');
    mockVerifyCSRF.mockResolvedValueOnce(
      NextResponse.json({ error: 'CSRF token missing' }, { status: 403 })
    );
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(403);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('passes the rate-limit rejection through (429)', async () => {
    const { NextResponse } = await import('next/server');
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    );
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(429);
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  describe('body validation', () => {
    it('returns 400 (not 500) on malformed JSON', async () => {
      const res = await POST(makeRequest('{not-json'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid JSON body');
      expect(mockRedisGet).not.toHaveBeenCalled();
    });

    it('returns 400 when the body is valid JSON but not an object (null)', async () => {
      const res = await POST(makeRequest('null'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid request body');
    });

    it('returns 400 when required fields are missing', async () => {
      for (const missing of ['username', 'signedChallenge', 'publicKey']) {
        const body = validBody();
        delete (body as Record<string, unknown>)[missing];
        const res = await POST(makeRequest(body));
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('Missing required fields');
      }
      expect(mockRedisGet).not.toHaveBeenCalled();
    });
  });

  describe('fail-closed on Redis unavailable', () => {
    it('returns 503 and never verifies a signature', async () => {
      mockGetRedis.mockReturnValue(null);
      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toBe('Login temporarily unavailable');
      expect(mockVerifyChallengeSignature).not.toHaveBeenCalled();
      expect(mockGetAccounts).not.toHaveBeenCalled();
    });
  });

  describe('challenge lookup', () => {
    it('returns 401 when no challenge is stored (expired or never issued)', async () => {
      mockRedisGet.mockResolvedValue(null);
      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid or expired challenge');
      expect(mockVerifyChallengeSignature).not.toHaveBeenCalled();
    });
  });

  describe('signature verification', () => {
    it('returns 401 on an invalid signature', async () => {
      mockVerifyChallengeSignature.mockReturnValueOnce(false);
      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid signature');
    });

    it('does NOT consume the challenge on a failed signature (retry UX)', async () => {
      mockVerifyChallengeSignature.mockReturnValueOnce(false);
      await POST(makeRequest(validBody()));
      expect(mockRedisGetdel).not.toHaveBeenCalled();
    });
  });

  describe('one-time (atomic) challenge consumption', () => {
    it('consumes via GETDEL with the prefixed username key on success', async () => {
      await POST(makeRequest(validBody()));
      expect(mockRedisGetdel).toHaveBeenCalledTimes(1);
      expect(mockRedisGetdel).toHaveBeenCalledWith('wallet:auth:challenge:alice');
    });

    it('concurrent replay: first GETDEL wins (200), second gets 401', async () => {
      // Two requests carrying the same VALID signature race. The atomic
      // GETDEL decides: the first call returns the stored value (consumed),
      // the second returns null (already consumed) and must be rejected —
      // this is the replay guarantee the old get → verify → del could not
      // enforce.
      mockRedisGetdel
        .mockResolvedValueOnce(STORED) // winner consumes
        .mockResolvedValueOnce(null); // loser finds nothing left

      const first = await POST(makeRequest(validBody()));
      const second = await POST(makeRequest(validBody()));

      expect(first.status).toBe(200);
      expect(second.status).toBe(401);
      const data = await second.json();
      expect(data.error).toBe('Invalid or expired challenge');
    });

    it('a GETDEL null (consumed/expired between get and consume) rejects 401 without account lookup', async () => {
      mockRedisGetdel.mockResolvedValueOnce(null);
      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(401);
      expect(mockGetAccounts).not.toHaveBeenCalled();
    });
  });

  describe('public-key attribution (validKeys membership)', () => {
    it.each([
      ['posting key', 'STMposting'],
      ['active key', 'STMactive'],
      ['owner key', 'STMowner'],
      ['memo key (current semantics: allowed, empty session)', 'STMmemo'],
    ])('accepts a signature made with the account %s', async (_label, publicKey) => {
      const res = await POST(makeRequest(validBody({ publicKey })));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('rejects a key that is not in any authority', async () => {
      const res = await POST(makeRequest(validBody({ publicKey: 'STMstranger' })));
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Public key does not match account');
      // The challenge was already consumed — the signature itself was valid,
      // attribution happens after consumption. Pinned so the ordering stays
      // conscious.
      expect(mockRedisGetdel).toHaveBeenCalledTimes(1);
    });
  });

  describe('account lookup', () => {
    it('returns 404 when the account no longer exists', async () => {
      mockGetAccounts.mockResolvedValueOnce([]);
      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Account not found');
    });
  });

  describe('overseer analytics', () => {
    it('fires the user_login overseer event without blocking the response', async () => {
      mockCollectOverseer.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 50))
      );
      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(200);
      expect(mockCollectOverseer).toHaveBeenCalledTimes(1);
      const payload = mockCollectOverseer.mock.calls[0]![0] as {
        measurement: string;
        fields: { username: string };
      };
      expect(payload.measurement).toBe('user_login');
      expect(payload.fields.username).toBe('alice');
    });
  });

  it('has no requiredAuthTypes gating on the server (#338 is client-side only)', async () => {
    // The authority-hierarchy gate added by #338 lives entirely in
    // login-form.tsx; the route accepts any authority level. A request with
    // an extra requiredAuthTypes field must be ignored (and still succeed) —
    // pinning that the route does not (and must not) trust client-declared
    // auth requirements.
    const res = await POST(makeRequest(validBody({ requiredAuthTypes: ['owner'] })));
    expect(res.status).toBe(200);
  });
});
