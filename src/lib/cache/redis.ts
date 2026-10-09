// Redis connection singleton and cache primitives
// Falls back gracefully when REDIS_URL is not configured

import Redis from 'ioredis';

let redis: Redis | null = null;
let redisUnavailable = false;
// Cooldown (ms) before a new connection attempt after a close. Prevents a
// reconnect-on-every-request thundering herd when Redis is flapping.
let reconnectAvailableAt = 0;
const RECONNECT_COOLDOWN_MS = 2000;

const KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'wallet';

export function redisKey(key: string): string {
  return `${KEY_PREFIX}:${key}`;
}

export function getRedis(): Redis | null {
  if (redis) return redis;
  if (redisUnavailable) return null;

  // Gate reconnection after a recent close to avoid a retry storm.
  const now = Date.now();
  if (now < reconnectAvailableAt) return null;

  const url = process.env.REDIS_URL;
  if (!url) {
    redisUnavailable = true;
    return null;
  }

  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 100, 2000);
      },
      lazyConnect: true,
      connectTimeout: 5000,
    });

    redis.on('error', (err) => {
      console.warn('Redis connection error:', err.message);
    });

    redis.on('close', () => {
      redis = null;
      redisUnavailable = false;
      // Enforce a short cooldown before the next getRedis() may reconnect.
      reconnectAvailableAt = Date.now() + RECONNECT_COOLDOWN_MS;
    });

    return redis;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

export interface CacheEntry<T> {
  data: T;
  degraded: boolean;
  staleAge?: number;
}

export async function cacheGet<T>(
  key: string,
  ttl: number,
  staleTtl: number
): Promise<CacheEntry<T> | null> {
  const r = getRedis();
  if (!r) return null;

  try {
    const [raw, remaining] = await Promise.all([
      r.get(redisKey(key)),
      r.ttl(redisKey(key)),
    ]);

    if (!raw || remaining < 0) return null;

    const totalTtl = ttl + staleTtl;
    const age = totalTtl - remaining;
    const data = JSON.parse(raw) as T;

    if (age <= ttl) {
      return { data, degraded: false };
    }

    return { data, degraded: true, staleAge: age };
  } catch {
    return null;
  }
}

export async function cacheSet<T>(
  key: string,
  ttl: number,
  staleTtl: number,
  data: T
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    const totalTtl = ttl + staleTtl;
    await r.set(redisKey(key), JSON.stringify(data), 'EX', totalTtl);
  } catch {
    // Cache write failure is non-critical
  }
}

export async function cacheDeleteByPrefix(prefix: string): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    let cursor = '0';
    do {
      const [next, keys] = await r.scan(cursor, 'MATCH', `${redisKey(prefix)}*`, 'COUNT', 100);
      if (keys.length > 0) await r.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } catch {
    // Cache delete failure is non-critical
  }
}
