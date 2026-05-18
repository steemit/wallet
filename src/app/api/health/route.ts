// GET /api/health
// Health check endpoint for container orchestration
import { NextResponse } from 'next/server';
import { checkSteemNodeHealth } from '@/lib/steem/server';
import { markSteemHealthy, markSteemUnhealthy } from '@/lib/cache/health-monitor';

export async function GET() {
  try {
    // Check Steem node connectivity
    const steemHealth = await checkSteemNodeHealth();

    const isHealthy = steemHealth.healthy;

    // Persist health status to Redis for other routes to check
    if (isHealthy) {
      await markSteemHealthy(steemHealth.blockNumber, steemHealth.latency);
    } else {
      await markSteemUnhealthy(steemHealth.error);
    }

    return NextResponse.json(
      {
        status: isHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        checks: {
          steem: {
            healthy: steemHealth.healthy,
            blockNumber: steemHealth.blockNumber,
            latency: steemHealth.latency,
            error: steemHealth.error,
          },
        },
      },
      { status: isHealthy ? 200 : 503 }
    );
  } catch (error) {
    await markSteemUnhealthy((error as Error).message);

    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: (error as Error).message,
      },
      { status: 503 }
    );
  }
}
