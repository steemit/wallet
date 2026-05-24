// GET /api/health
// Health check with stale-while-revalidate caching.
// Returns cached status when fresh (<60s), triggers background probe when stale.
// Falls back to in-memory debounce when Redis is unavailable.
import { NextResponse } from 'next/server';
import { checkSteemNodeHealth } from '@/lib/steem/server';
import {
  getSteemHealthStale,
  markSteemHealthy,
  markSteemUnhealthy,
  acquireProbeLock,
  releaseProbeLock,
  FRESH_THRESHOLD,
} from '@/lib/cache/health-monitor';

// In-memory debounce: when Redis is down, limit probes to one per FRESH_THRESHOLD
let lastProbeAt = 0;

function buildResponse(healthy: boolean, blockNumber?: number, latency?: number, error?: string, stale = false) {
  const headers: Record<string, string> = {};
  if (stale) headers['X-Health-Stale'] = 'true';

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        steem: { healthy, blockNumber, latency, error },
      },
    },
    { status: healthy ? 200 : 503, headers }
  );
}

export async function GET() {
  const cached = await getSteemHealthStale();

  // Fresh cache — return immediately, no RPC
  if (cached && Date.now() - cached.checkedAt <= FRESH_THRESHOLD) {
    return buildResponse(cached.healthy, cached.blockNumber, cached.latency, cached.error);
  }

  // Stale or no cache — try to acquire probe lock
  const locked = await acquireProbeLock();

  if (!locked) {
    // Another request is probing — return stale data if available
    if (cached) {
      return buildResponse(cached.healthy, cached.blockNumber, cached.latency, cached.error, true);
    }
    // No Redis and no cache — in-memory debounce to avoid probing on every request
    if (Date.now() - lastProbeAt < FRESH_THRESHOLD) {
      return buildResponse(false, undefined, undefined, undefined, true);
    }
  }

  lastProbeAt = Date.now();

  try {
    const steemHealth = await checkSteemNodeHealth();

    if (steemHealth.healthy) {
      await markSteemHealthy(steemHealth.blockNumber, steemHealth.latency);
    } else {
      await markSteemUnhealthy(steemHealth.error);
    }

    return buildResponse(steemHealth.healthy, steemHealth.blockNumber, steemHealth.latency, steemHealth.error);
  } catch (error) {
    await markSteemUnhealthy((error as Error).message);

    return buildResponse(false, undefined, undefined, (error as Error).message);
  } finally {
    if (locked) await releaseProbeLock();
  }
}
