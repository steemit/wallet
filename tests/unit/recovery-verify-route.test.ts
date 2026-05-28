import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/recovery/verify/[code]/route';

// Mock the Drizzle db module
const mockFindFirst = vi.fn();
const mockDb = {
  query: {
    arecs: {
      findFirst: mockFindFirst,
    },
  },
};
const mockGetDb = vi.fn().mockReturnValue(mockDb);

vi.mock('@/lib/db', () => ({
  getDb: () => vi.mocked(mockGetDb)(),
}));

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

  it('returns error for already used (closed) code', async () => {
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

    expect(data.status).toBe('error');
    expect(res.status).toBe(400);
  });

  it('returns error for open (not yet confirmed) code', async () => {
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
});
