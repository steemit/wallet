// Health monitor: tracks Steem RPC health in Redis
// Routes check this before attempting RPC calls to avoid timeout delays

import { getRedis, redisKey } from './redis';

const HEALTH_KEY = 'health:steem';
const PROBE_LOCK_KEY = 'health:steem:probe-lock';
const HEALTH_TTL = 60; // seconds
const PROBE_LOCK_TTL = 30; // seconds — must exceed worst-case probe duration
export const FRESH_THRESHOLD = 60_000; // ms

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
    const raw = await redis.get(redisKey(HEALTH_KEY));
    if (!raw) return null;

    const status = JSON.parse(raw) as SteemHealthStatus;

    // Stale if older than 60s
    if (Date.now() - status.checkedAt > FRESH_THRESHOLD) return null;

    return status;
  } catch {
    return null;
  }
}

/**
 * Like getSteemHealth() but returns data regardless of freshness.
 * Used by /api/health for stale-while-revalidate.
 */
export async function getSteemHealthStale(): Promise<SteemHealthStatus | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const raw = await redis.get(redisKey(HEALTH_KEY));
    if (!raw) return null;
    return JSON.parse(raw) as SteemHealthStatus;
  } catch {
    return null;
  }
}

export async function markSteemHealthy(blockNumber?: number, latency?: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(
      redisKey(HEALTH_KEY),
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
      redisKey(HEALTH_KEY),
      JSON.stringify({ healthy: false, checkedAt: Date.now(), error }),
      'EX',
      HEALTH_TTL
    );
  } catch {
    // Non-critical
  }
}

export async function isSteemKnownDown(): Promise<boolean> {
  const health = await getSteemHealth();
  if (!health) return false;
  return !health.healthy;
}

export async function acquireProbeLock(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    const result = await redis.set(
      redisKey(PROBE_LOCK_KEY),
      String(Date.now()),
      'EX',
      PROBE_LOCK_TTL,
      'NX'
    );
    return result === 'OK';
  } catch {
    return false;
  }
}

export async function releaseProbeLock(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(redisKey(PROBE_LOCK_KEY));
  } catch {
    // Non-critical
  }
}
