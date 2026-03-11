// GET /api/health
// Health check endpoint for container orchestration
import { NextResponse } from 'next/server';
import { checkSteemNodeHealth } from '@/lib/steem/server';

export async function GET() {
  try {
    // Check Steem node connectivity
    const steemHealth = await checkSteemNodeHealth();

    const isHealthy = steemHealth.healthy;

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
