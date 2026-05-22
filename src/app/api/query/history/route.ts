// GET /api/query/history?username=user&limit=100&from=-1&ops=transfer,author_reward,...
// Get account transaction history with optional server-side op-type filtering.
//
// Without `ops`: returns raw Steem history (legacy path, backward compatible).
// With `ops`:    server fetches batches internally until `limit` matching ops are
//                found, normalizes them, and returns { history, nextFrom, exhausted }.
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { getRedis } from '@/lib/cache/redis';
import { isSteemKnownDown, markSteemHealthy, markSteemUnhealthy } from '@/lib/cache/health-monitor';
import { normalizeSteemHistoryList, type SteemHistoryItem } from '@/lib/wallet/normalize-history';
import { WALLET_OP_TYPES } from '@/lib/steem/history-ops';

const FALLBACK_TTL = 300; // 5 minutes
const ALLOWED_OPS = new Set<string>(WALLET_OP_TYPES);
const MAX_BATCHES = 20; // max 2,000 ops scanned per filtered request
const BATCH_SIZE = 100; // Steem API hard cap

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 50,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 100;
    const fromParam = searchParams.get('from');
    const from = fromParam !== null ? parseInt(fromParam, 10) : -1;
    const opsParam = searchParams.get('ops');
    const requestedOps: string[] | null = opsParam
      ? opsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : null;

    if (!username) {
      return NextResponse.json({ error: 'Missing username parameter' }, { status: 400 });
    }
    if (limit < 1 || limit > 100) {
      return NextResponse.json({ error: 'Limit must be between 1 and 100' }, { status: 400 });
    }
    if (fromParam !== null && (!Number.isFinite(from) || from < -1)) {
      return NextResponse.json({ error: 'Invalid from parameter' }, { status: 400 });
    }
    if (requestedOps) {
      const invalid = requestedOps.find((o) => !ALLOWED_OPS.has(o));
      if (invalid) {
        return NextResponse.json({ error: `Unknown op type: ${invalid}` }, { status: 400 });
      }
    }

    // ── Filtered path ────────────────────────────────────────────────────────
    if (requestedOps) {
      return handleFilteredRequest(username, limit, from, requestedOps);
    }

    // ── Legacy path (no ops param) ───────────────────────────────────────────
    if (await isSteemKnownDown()) {
      const fallback = await getLegacyFallback(username);
      if (fallback) return legacyDegradedResponse(fallback);
    }

    try {
      const history = await SteemService.getAccountHistory(username, limit, from);
      await markSteemHealthy();
      if (from === -1) await saveLegacyFallback(username, history);
      return NextResponse.json({ success: true, history });
    } catch (error) {
      await markSteemUnhealthy((error as Error).message);
      const fallback = await getLegacyFallback(username);
      if (fallback) return legacyDegradedResponse(fallback);
      throw error;
    }
  } catch (error) {
    console.error('Error fetching history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history', details: (error as Error).message },
      { status: 500 }
    );
  }
}

// ── Filtered request handler ─────────────────────────────────────────────────

async function handleFilteredRequest(
  username: string,
  limit: number,
  from: number,
  requestedOps: string[]
): Promise<NextResponse> {
  const opsKey = [...requestedOps].sort().join('+');
  const cacheKey = `cache:query:history-filtered:${username}:${opsKey}`;

  if (await isSteemKnownDown()) {
    const fallback = await getFilteredFallback(cacheKey);
    if (fallback) return filteredDegradedResponse(fallback);
    return NextResponse.json({ error: 'Steem node unavailable and no cached data' }, { status: 503 });
  }

  try {
    const { history, nextFrom, exhausted } = await fetchFiltered(username, limit, from, requestedOps);
    await markSteemHealthy();
    if (from === -1) await saveFilteredFallback(cacheKey, { history, nextFrom, exhausted });
    return NextResponse.json({ success: true, history, nextFrom, exhausted });
  } catch (error) {
    await markSteemUnhealthy((error as Error).message);
    const fallback = await getFilteredFallback(cacheKey);
    if (fallback) return filteredDegradedResponse(fallback);
    throw error;
  }
}

interface FilteredResult {
  history: SteemHistoryItem[];
  nextFrom: number | null;
  exhausted: boolean;
}

async function fetchFiltered(
  username: string,
  limit: number,
  from: number,
  requestedOps: string[]
): Promise<FilteredResult> {
  const opSet = new Set(requestedOps);
  const accumulated: SteemHistoryItem[] = [];
  let cursor = from;
  let isExhausted = false;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    // Clamp fetchLimit: never request more than the cursor index (avoids duplicates near history start)
    const fetchLimit = cursor === -1 ? BATCH_SIZE : Math.min(BATCH_SIZE, Math.max(1, cursor));

    const raw = await SteemService.getAccountHistory(username, fetchLimit, cursor);
    const normalized = normalizeSteemHistoryList(raw);

    if (normalized.length === 0) {
      isExhausted = true;
      break;
    }

    const matching = normalized.filter((item) => opSet.has(item.op[0]));
    accumulated.push(...matching);

    // Advance cursor using oldest index in the WHOLE batch (not just matching),
    // so non-matching ops near the bottom don't stall progress.
    let oldestInBatch: number | undefined;
    for (const item of normalized) {
      if (typeof item.index === 'number') {
        if (oldestInBatch === undefined || item.index < oldestInBatch) {
          oldestInBatch = item.index;
        }
      }
    }

    if (oldestInBatch === undefined) {
      isExhausted = true;
      break;
    }

    cursor = oldestInBatch - 1;
    if (cursor < 0) {
      isExhausted = true;
      break;
    }

    if (accumulated.length >= limit) break;
  }

  const result = accumulated.slice(0, limit);

  let oldestInResult: number | undefined;
  for (const item of result) {
    if (typeof item.index === 'number') {
      if (oldestInResult === undefined || item.index < oldestInResult) {
        oldestInResult = item.index;
      }
    }
  }

  const nextFrom =
    isExhausted || oldestInResult === undefined || oldestInResult <= 0
      ? null
      : oldestInResult - 1;

  return { history: result, nextFrom, exhausted: isExhausted };
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function legacyDegradedResponse(history: unknown[]) {
  const response = NextResponse.json({ success: true, history, degraded: true });
  response.headers.set('X-Degraded', 'true');
  return response;
}

function filteredDegradedResponse(data: FilteredResult) {
  const response = NextResponse.json({ success: true, ...data, degraded: true });
  response.headers.set('X-Degraded', 'true');
  return response;
}

async function getLegacyFallback(username: string): Promise<unknown[] | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`cache:query:history-fallback:${username}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveLegacyFallback(username: string, history: unknown): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(
      `cache:query:history-fallback:${username}`,
      JSON.stringify(history),
      'EX',
      FALLBACK_TTL
    );
  } catch { /* non-critical */ }
}

async function getFilteredFallback(cacheKey: string): Promise<FilteredResult | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(cacheKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveFilteredFallback(cacheKey: string, data: FilteredResult): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(cacheKey, JSON.stringify(data), 'EX', FALLBACK_TTL);
  } catch { /* non-critical */ }
}
