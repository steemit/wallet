// GET /api/query/history?username=user&limit=100&from=-1&ops=transfer,author_reward,...
// Get account transaction history with optional server-side op-type filtering.
//
// Without `ops`: returns raw Steem history (legacy path, backward compatible).
// With `ops`:    fetches ONE batch (up to BATCH_SIZE entries) per request, keeps
//                up to `limit` matching ops, and returns { history, nextFrom,
//                exhausted }; the client drives pagination by passing nextFrom
//                back as `from` on the next request.
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { getRedis, redisKey } from '@/lib/cache/redis';
import { hashedCacheKey, normalizeAccountForCache } from '@/lib/cache/cache-key';
import { isSteemKnownDown } from '@/lib/cache/health-monitor';
import { normalizeSteemHistoryList, type SteemHistoryItem } from '@/lib/wallet/normalize-history';
import { WALLET_OP_TYPES } from '@/lib/steem/history-ops';

const FALLBACK_TTL = 300; // 5 minutes
const ALLOWED_OPS = new Set<string>(WALLET_OP_TYPES);
const BATCH_SIZE = 100; // Steem API hard cap — one batch per request

// Per-account rows (memos included) — private per the user-scoped rule, and
// no-store because this route keeps no fresh server-side cache (§3.5 fallback
// only), so there is no freshness window to advertise to any cache.
const HISTORY_CACHE_CONTROL = 'private, no-store';

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
      ? [...new Set(opsParam.split(',').map((s) => s.trim()).filter(Boolean))]
      : null;

    if (!username) {
      return NextResponse.json({ error: 'Missing username parameter' }, { status: 400 });
    }
    // One account = one cache key / one upstream call, whatever case or '@'
    // spelling the client sent.
    const account = normalizeAccountForCache(username);
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
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
      // `return await` (not `return`): without the await, a rejection from
      // handleFilteredRequest would bypass this try/catch entirely and escape
      // as an unhandled rejection instead of the unified 503 protocol.
      return await handleFilteredRequest(account, from, requestedOps, limit);
    }

    // ── Legacy path (no ops param) ───────────────────────────────────────────
    if (await isSteemKnownDown()) {
      const fallback = await getLegacyFallback(account);
      if (fallback) return legacyDegradedResponse(fallback);
    }

    try {
      const history = await SteemService.getAccountHistory(account, limit, from);
      if (from === -1) await saveLegacyFallback(account, history);
      return historyResponse({ success: true, history });
    } catch (error) {
      const fallback = await getLegacyFallback(account);
      if (fallback) return legacyDegradedResponse(fallback);
      throw error;
    }
  } catch (error) {
    console.error('Error fetching history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history', degraded: true },
      { status: 503 }
    );
  }
}

// ── Filtered request handler ─────────────────────────────────────────────────

async function handleFilteredRequest(
  username: string,
  from: number,
  requestedOps: string[],
  limit: number
): Promise<NextResponse> {
  const opsKey = [...requestedOps].sort().join('+');
  const cacheKey = redisKey(hashedCacheKey('cache:query:history-filtered', username, opsKey));

  if (await isSteemKnownDown()) {
    const fallback = await getFilteredFallback(cacheKey);
    if (fallback) return filteredDegradedResponse(fallback);
    return NextResponse.json(
      { error: 'Steem node unavailable and no cached data', degraded: true },
      { status: 503 }
    );
  }

  try {
    const { history, nextFrom, exhausted } = await fetchFiltered(username, from, requestedOps, limit);
    if (from === -1) await saveFilteredFallback(cacheKey, { history, nextFrom, exhausted });
    return historyResponse({ success: true, history, nextFrom, exhausted });
  } catch (error) {
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
  from: number,
  requestedOps: string[],
  limit: number
): Promise<FilteredResult> {
  const opSet = new Set(requestedOps);
  // One Steem RPC call per HTTP request — client controls the outer loop.
  // Clamp: never request more than the cursor index (avoids duplicates near history start).
  const fetchLimit = from === -1 ? BATCH_SIZE : Math.min(BATCH_SIZE, Math.max(1, from));

  const raw = await SteemService.getAccountHistory(username, fetchLimit, from);
  const normalized = normalizeSteemHistoryList(raw);

  const matching = normalized.filter((item) => opSet.has(item.op[0]));

  // `limit` caps the matching items returned per request (it is validated
  // above and must not be silently ignored). Truncation keeps the NEWEST
  // `limit` matches; the cursor then resumes below the oldest RETURNED item
  // so the matches dropped by the truncation are picked up by the next page
  // instead of being skipped forever.
  const truncated = matching.length > limit;
  const history = truncated ? matching.slice(0, limit) : matching;

  const oldestIndex = (items: SteemHistoryItem[]): number | undefined => {
    let oldest: number | undefined;
    for (const item of items) {
      if (typeof item.index === 'number') {
        if (oldest === undefined || item.index < oldest) oldest = item.index;
      }
    }
    return oldest;
  };

  // Advance the cursor using the oldest index in the WHOLE batch (not just
  // matching), so non-matching ops near the bottom don't stall progress —
  // unless we truncated, where the cursor must stop at the oldest RETURNED
  // match to avoid skipping the truncated remainder.
  const oldestInBatch = oldestIndex(normalized);
  const oldestReturned = truncated ? oldestIndex(history) : undefined;
  const resumeFrom = truncated ? (oldestReturned ?? oldestInBatch) : oldestInBatch;

  const exhausted =
    !truncated && (normalized.length === 0 || oldestInBatch === undefined || oldestInBatch <= 0);
  const nextFrom = exhausted || resumeFrom === undefined ? null : resumeFrom - 1;

  return { history, nextFrom, exhausted };
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

// Every 200 body this route returns is user-scoped (raw account history);
// stamp the private/no-store header uniformly on fresh and degraded paths.
function historyResponse(body: Record<string, unknown>): NextResponse {
  const response = NextResponse.json(body);
  response.headers.set('Cache-Control', HISTORY_CACHE_CONTROL);
  return response;
}

function legacyDegradedResponse(history: unknown[]) {
  const response = historyResponse({ success: true, history, degraded: true });
  response.headers.set('X-Degraded', 'true');
  return response;
}

function filteredDegradedResponse(data: FilteredResult) {
  const response = historyResponse({ success: true, ...data, degraded: true });
  response.headers.set('X-Degraded', 'true');
  return response;
}

async function getLegacyFallback(username: string): Promise<unknown[] | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(redisKey(hashedCacheKey('cache:query:history-fallback', username)));
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
      redisKey(hashedCacheKey('cache:query:history-fallback', username)),
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
