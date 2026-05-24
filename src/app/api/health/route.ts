// GET /api/health
// Health check with stale-while-revalidate caching.
// Returns cached status when fresh (<60s), triggers background probe when stale.
// Concurrent probes share one in-flight request (no false 503 while waiting).
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

let inFlightProbe: Promise<Awaited<ReturnType<typeof checkSteemNodeHealth>>> | null = null;

function runSharedProbe() {
  if (!inFlightProbe) {
    inFlightProbe = checkSteemNodeHealth().finally(() => {
      inFlightProbe = null;
    });
  }
  return inFlightProbe;
}

function buildResponse(
  healthy: boolean,
  blockNumber?: number,
  latency?: number,
  error?: string,
  stale = false
) {
  if (!healthy) {
    console.warn(
      '[api/health] Steem degraded',
      stale ? '(stale cache)' : '(live probe)',
      error ?? '(no error detail)'
    );
  }

  const headers: Record<string, string> = {};
  if (stale) headers['X-Health-Stale'] = 'true';

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        steem: { healthy, ...(blockNumber !== undefined && { blockNumber }), ...(latency !== undefined && { latency }), ...(error !== undefined && { error }) },
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

  // Stale cache — another instance may be probing; serve stale if we cannot lock
  let acquiredLock = false;
  if (cached) {
    acquiredLock = await acquireProbeLock();
    if (!acquiredLock) {
      return buildResponse(cached.healthy, cached.blockNumber, cached.latency, cached.error, true);
    }
  }

  try {
    const steemHealth = await runSharedProbe();

    if (steemHealth.healthy) {
      await markSteemHealthy(steemHealth.blockNumber, steemHealth.latency);
    } else {
      await markSteemUnhealthy(steemHealth.error);
    }

    return buildResponse(
      steemHealth.healthy,
      steemHealth.blockNumber,
      steemHealth.latency,
      steemHealth.error
    );
  } catch (error) {
    const message = (error as Error).message;
    await markSteemUnhealthy(message);
    return buildResponse(false, undefined, undefined, message);
  } finally {
    if (acquiredLock) await releaseProbeLock();
  }
}
