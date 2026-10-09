import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/recovery/verify/[code]/route';

// Mock rate limit middleware
vi.mock('@/lib/middleware', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
}));

// Mock the Drizzle db module
const mockFindFirst = vi.fn();
let mockUpdateFn: ReturnType<typeof vi.fn>;
let lastUpdateChains: { set: ReturnType<typeof vi.fn>; where: ReturnType<typeof vi.fn> }[] = [];
const mockDb = {
  query: {
    arecs: {
      findFirst: mockFindFirst,
    },
  },
  get update() {
    return mockUpdateFn;
  },
};
const mockGetDb = vi.fn().mockReturnValue(mockDb);

vi.mock('@/lib/db', () => ({
  getDb: () => vi.mocked(mockGetDb)(),
}));

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Queue one drizzle update result per expected update call, in order. */
function setupUpdateMocks(...results: unknown[]) {
  lastUpdateChains = results.map((result) => {
    const chain: { set: ReturnType<typeof vi.fn>; where: ReturnType<typeof vi.fn> } = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(result ?? undefined),
    };
    chain.set.mockReturnValue({ where: chain.where });
    return chain;
  });
  mockUpdateFn = vi.fn();
  for (const chain of lastUpdateChains) {
    mockUpdateFn.mockReturnValueOnce({ set: chain.set });
  }
}

function makeRequest(code: string): Request {
  return new Request(`http://localhost/api/recovery/verify/${code}`);
}

// Cast to any to pass dynamic route params
type GETWithParams = (req: Request, ctx: { params: Promise<{ code: string }> }) => Promise<Response>;

const VALID_CODE = '5bc350832943043e8a82'; // 20 hex chars

describe('GET /api/recovery/verify/[code]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockReturnValue(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns account_name for valid confirmed code', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 1,
      accountName: 'alice',
      status: 'confirmed',
    });

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.status).toBe('ok');
    expect(data.account_name).toBe('alice');
    expect(data.record_status).toBe('confirmed');
    expect(res.status).toBe(200);
  });

  it('returns ok with record_status=closed for a confirmed-but-not-broadcast code (retry mode)', async () => {
    // confirm succeeded on-chain (request_account_recovery submitted) but the
    // final recover_account broadcast may still be pending — the step-2 page
    // uses this state to offer a retry-broadcast mode without re-running
    // confirm (whose CAS would reject the closed record).
    mockFindFirst.mockResolvedValueOnce({
      id: 2,
      accountName: 'bob',
      status: 'closed',
    });

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.status).toBe('ok');
    expect(data.account_name).toBe('bob');
    expect(data.record_status).toBe('closed');
    expect(res.status).toBe(200);
  });

  it('returns error for non-existent code', async () => {
    mockFindFirst.mockResolvedValueOnce(undefined);

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.status).toBe('error');
    expect(data.error).toBe('Confirmation code not found');
    expect(res.status).toBe(404);
  });

  it('returns state-accurate error for open (not yet confirmed) code', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 3,
      accountName: 'charlie',
      status: 'open',
    });

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.status).toBe('error');
    expect(data.record_status).toBe('open');
    expect(data.error).toBe('Recovery request has not been approved yet');
    expect(res.status).toBe(400);
  });

  it('returns state-accurate error for processing code (in progress)', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 4,
      accountName: 'dave',
      status: 'processing',
    });

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.status).toBe('error');
    expect(data.record_status).toBe('processing');
    expect(data.error).toContain('currently being processed');
    expect(res.status).toBe(400);
  });

  it('returns state-accurate error for expired code', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 5,
      accountName: 'erin',
      status: 'expired',
    });

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.status).toBe('error');
    expect(data.record_status).toBe('expired');
    expect(data.error).toContain('expired');
    expect(res.status).toBe(400);
  });

  it('returns state-accurate error for consumed code (already used)', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 6,
      accountName: 'frank',
      status: 'consumed',
    });

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.status).toBe('error');
    expect(data.record_status).toBe('consumed');
    expect(data.error).toContain('already been used');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid code format', async () => {
    const res = await (GET as unknown as GETWithParams)(
      makeRequest('bad-code'),
      { params: Promise.resolve({ code: 'bad-code' }) }
    );
    const data = await res.json();
    expect(data.status).toBe('error');
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid confirmation code');
  });

  it('returns 503 when database is unavailable', async () => {
    mockGetDb.mockReturnValue(null);

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.status).toBe('error');
    expect(res.status).toBe(503);
  });

  it('returns 500 when database throws', async () => {
    mockFindFirst.mockRejectedValueOnce(new Error('Connection lost'));

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.status).toBe('error');
    expect(res.status).toBe(500);
  });

  // ---- B-4: lazy code-TTL enforcement (24h) ----

  it('confirmed record confirmed 25h ago → 400 expired + terminal status persisted', async () => {
    setupUpdateMocks([{ affectedRows: 1 }, []]);
    mockFindFirst.mockResolvedValueOnce({
      id: 7,
      accountName: 'grace',
      status: 'confirmed',
      updatedAt: new Date(Date.now() - 25 * HOUR),
    });

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.status).toBe('error');
    expect(data.record_status).toBe('expired');
    expect(data.error).toContain('expired');
    expect(res.status).toBe(400);
    expect(mockUpdateFn).toHaveBeenCalledTimes(1);
    expect(lastUpdateChains[0]!.set).toHaveBeenCalledWith({ status: 'expired' });
  });

  it('processing record stuck 25h (crashed long ago) → 400 expired, not reclaimed', async () => {
    setupUpdateMocks([{ affectedRows: 1 }, []]);
    mockFindFirst.mockResolvedValueOnce({
      id: 8,
      accountName: 'heidi',
      status: 'processing',
      updatedAt: new Date(Date.now() - 25 * HOUR),
    });

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.record_status).toBe('expired');
    expect(res.status).toBe(400);
    expect(lastUpdateChains[0]!.set).toHaveBeenCalledWith({ status: 'expired' });
  });

  it('confirmed record within the TTL (1h ago) → 200 ok (no lifecycle writes)', async () => {
    setupUpdateMocks();
    mockFindFirst.mockResolvedValueOnce({
      id: 9,
      accountName: 'ivan',
      status: 'confirmed',
      updatedAt: new Date(Date.now() - HOUR),
    });

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(data.status).toBe('ok');
    expect(data.record_status).toBe('confirmed');
    expect(res.status).toBe(200);
    expect(mockUpdateFn).not.toHaveBeenCalled();
  });

  it('lazy-expire write failure does not change the expired answer', async () => {
    // The expired verdict is derived from timestamps, not the write.
    const chain: { set: ReturnType<typeof vi.fn>; where: ReturnType<typeof vi.fn> } = {
      set: vi.fn(),
      where: vi.fn().mockRejectedValue(new Error('Connection lost')),
    };
    chain.set.mockReturnValue({ where: chain.where });
    mockUpdateFn = vi.fn().mockReturnValue({ set: chain.set });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockFindFirst.mockResolvedValueOnce({
        id: 10,
        accountName: 'judy',
        status: 'confirmed',
        updatedAt: new Date(Date.now() - 25 * HOUR),
      });

      const res = await (GET as unknown as GETWithParams)(
        makeRequest(VALID_CODE),
        { params: Promise.resolve({ code: VALID_CODE }) }
      );
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.record_status).toBe('expired');
    } finally {
      err.mockRestore();
    }
  });

  // ---- B-4: stuck-processing self-heal (10-minute bound) ----

  it('processing record stuck 15 min → reclaimed to confirmed → 200 ok confirmed', async () => {
    setupUpdateMocks([{ affectedRows: 1 }, []]);
    mockFindFirst.mockResolvedValueOnce({
      id: 11,
      accountName: 'kate',
      status: 'processing',
      updatedAt: new Date(Date.now() - 15 * MINUTE),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const res = await (GET as unknown as GETWithParams)(
        makeRequest(VALID_CODE),
        { params: Promise.resolve({ code: VALID_CODE }) }
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.account_name).toBe('kate');
      expect(data.record_status).toBe('confirmed');
      expect(lastUpdateChains[0]!.set).toHaveBeenCalledWith({ status: 'confirmed' });
    } finally {
      warn.mockRestore();
    }
  });

  it('lost the reclaim race → falls through to the processing response', async () => {
    setupUpdateMocks([{ affectedRows: 0 }, []]);
    mockFindFirst.mockResolvedValueOnce({
      id: 12,
      accountName: 'liam',
      status: 'processing',
      updatedAt: new Date(Date.now() - 15 * MINUTE),
    });

    const res = await (GET as unknown as GETWithParams)(
      makeRequest(VALID_CODE),
      { params: Promise.resolve({ code: VALID_CODE }) }
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.record_status).toBe('processing');
    expect(data.error).toContain('currently being processed');
  });
});
