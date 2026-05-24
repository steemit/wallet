import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock redis module
const mockRedisInstance = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('@/lib/cache/redis', () => ({
  getRedis: () => mockRedisInstance,
  redisKey: (k: string) => `wallet:${k}`,
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDeleteByPrefix: vi.fn(),
}));

import {
  getSteemHealth,
  markSteemHealthy,
  markSteemUnhealthy,
  isSteemKnownDown,
} from '@/lib/cache/health-monitor';

describe('Health Monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getSteemHealth', () => {
    it('returns null when no health data in Redis', async () => {
      mockRedisInstance.get.mockResolvedValueOnce(null);
      expect(await getSteemHealth()).toBeNull();
    });

    it('returns health status when data exists', async () => {
      const status = { healthy: true, checkedAt: Date.now(), blockNumber: 12345 };
      mockRedisInstance.get.mockResolvedValueOnce(JSON.stringify(status));
      const result = await getSteemHealth();
      expect(result).toEqual(status);
    });

    it('returns null when health data is older than 60s', async () => {
      const status = { healthy: false, checkedAt: Date.now() - 61_000 };
      mockRedisInstance.get.mockResolvedValueOnce(JSON.stringify(status));
      expect(await getSteemHealth()).toBeNull();
    });
  });

  describe('markSteemHealthy', () => {
    it('writes healthy status to Redis with TTL', async () => {
      await markSteemHealthy(12345, 50);
      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        'wallet:health:steem',
        expect.any(String),
        'EX',
        60
      );
      const [, value] = mockRedisInstance.set.mock.calls[0]!;
      const parsed = JSON.parse(value as string);
      expect(parsed.healthy).toBe(true);
      expect(parsed.blockNumber).toBe(12345);
      expect(parsed.latency).toBe(50);
    });
  });

  describe('markSteemUnhealthy', () => {
    it('writes unhealthy status with error', async () => {
      await markSteemUnhealthy('Connection timeout');
      const [, value] = mockRedisInstance.set.mock.calls[0]!;
      const parsed = JSON.parse(value as string);
      expect(parsed.healthy).toBe(false);
      expect(parsed.error).toBe('Connection timeout');
    });
  });

  describe('isSteemKnownDown', () => {
    it('returns false when healthy', async () => {
      mockRedisInstance.get.mockResolvedValueOnce(
        JSON.stringify({ healthy: true, checkedAt: Date.now() })
      );
      expect(await isSteemKnownDown()).toBe(false);
    });

    it('returns true when unhealthy', async () => {
      mockRedisInstance.get.mockResolvedValueOnce(
        JSON.stringify({ healthy: false, checkedAt: Date.now() })
      );
      expect(await isSteemKnownDown()).toBe(true);
    });

    it('returns false when no health data', async () => {
      mockRedisInstance.get.mockResolvedValueOnce(null);
      expect(await isSteemKnownDown()).toBe(false);
    });
  });
});
