// Health monitor: tracks Steem RPC health in Redis
// Routes check this before attempting RPC calls to avoid timeout delays

import { getRedis } from './redis';

const HEALTH_KEY = 'health:steem';
const HEALTH_TTL = 60; // seconds

export interface SteemHealthStatus {
  healthy: boolean;
  checkedAt: number;
  blockNumber?: number;
  latency?: number;
  error?: string;
}

export async function getSteemHealth(): Promise<SteemHealthStatus | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const raw = await redis.get(HEALTH_KEY);
    if (!raw) return null;

    const status = JSON.parse(raw) as SteemHealthStatus;

    // Stale if older than 60s
    if (Date.now() - status.checkedAt > 60_000) return null;

    return status;
  } catch {
    return null;
  }
}

export async function markSteemHealthy(blockNumber?: number, latency?: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(
      HEALTH_KEY,
      JSON.stringify({ healthy: true, checkedAt: Date.now(), blockNumber, latency }),
      'EX',
      HEALTH_TTL
    );
  } catch {
    // Non-critical
  }
}

export async function markSteemUnhealthy(error?: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(
      HEALTH_KEY,
      JSON.stringify({ healthy: false, checkedAt: Date.now(), error }),
      'EX',
      HEALTH_TTL
    );
  } catch {
    // Non-critical
  }
}

/**
 * Returns true if the Steem node is known to be unhealthy.
 * Returns false if healthy or status is unknown (no recent check).
 */
export async function isSteemKnownDown(): Promise<boolean> {
  const health = await getSteemHealth();
  if (!health) return false;
  return !health.healthy;
}
