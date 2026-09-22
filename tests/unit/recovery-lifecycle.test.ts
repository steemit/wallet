/**
 * Unit tests for the arecs lifecycle helpers (code TTL + stuck-claim
 * reclaim) — the timestamp predicates and the CAS update builders.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  RECOVERY_CODE_TTL_MS,
  PROCESSING_STUCK_MS,
  toEpochMs,
  isBeyondCodeTtl,
  isStuckProcessingClaim,
  markExpiredIfStale,
  reclaimStuckProcessing,
} from '@/lib/recovery/lifecycle';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);

describe('toEpochMs', () => {
  it('parses Date objects', () => {
    expect(toEpochMs(new Date(NOW))).toBe(NOW);
  });

  it('parses bare datetime strings as UTC', () => {
    expect(toEpochMs('2026-09-22 12:00:00')).toBe(NOW);
  });

  it('parses already-zoned ISO strings', () => {
    expect(toEpochMs('2026-09-22T12:00:00Z')).toBe(NOW);
  });

  it('returns null for missing or invalid values (never stale)', () => {
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs('')).toBeNull();
    expect(toEpochMs(new Date('not-a-date'))).toBeNull();
  });
});

describe('isBeyondCodeTtl', () => {
  it('true when the last state change is older than the 24h TTL', () => {
    expect(isBeyondCodeTtl(new Date(NOW - RECOVERY_CODE_TTL_MS - 1), NOW)).toBe(true);
  });

  it('false within the TTL', () => {
    expect(isBeyondCodeTtl(new Date(NOW - RECOVERY_CODE_TTL_MS + 60_000), NOW)).toBe(false);
  });

  it('false for unknown timestamps (legacy rows stay usable)', () => {
    expect(isBeyondCodeTtl(undefined, NOW)).toBe(false);
  });
});

describe('isStuckProcessingClaim', () => {
  it('true when a processing claim is older than the stuck threshold', () => {
    expect(isStuckProcessingClaim(new Date(NOW - PROCESSING_STUCK_MS - 1), NOW)).toBe(true);
  });

  it('false within the threshold (live claim is never stuck)', () => {
    expect(isStuckProcessingClaim(new Date(NOW - PROCESSING_STUCK_MS + 60_000), NOW)).toBe(false);
  });

  it('false for unknown timestamps (live claim is never reclaimed)', () => {
    expect(isStuckProcessingClaim(null, NOW)).toBe(false);
  });
});

// ---- CAS builders (against a fake drizzle db) ----

type Chain = {
  set: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
};

function makeFakeDb(result: unknown) {
  const chains: Chain[] = [];
  const update = vi.fn(() => {
    const chain: Chain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(result),
    };
    chain.set.mockReturnValue({ where: chain.where });
    chains.push(chain);
    return { set: chain.set };
  });
  return { db: { update }, chains };
}

describe('markExpiredIfStale', () => {
  const staleUpdatedAt = new Date(NOW - RECOVERY_CODE_TTL_MS - 5 * 60_000);

  it('issues the terminal expired CAS and returns affected rows', async () => {
    const { db, chains } = makeFakeDb([{ affectedRows: 1 }, []]);
    const affected = await markExpiredIfStale(
      db as never,
      '5bc350832943043e8a82',
      'alice',
      'confirmed',
      staleUpdatedAt,
      NOW
    );
    expect(affected).toBe(1);
    expect(chains[0]!.set).toHaveBeenCalledWith({ status: 'expired' });
  });

  it('propagates a CAS miss as 0', async () => {
    const { db } = makeFakeDb([{ affectedRows: 0 }, []]);
    expect(
      await markExpiredIfStale(db as never, 'c', 'a', 'confirmed', staleUpdatedAt, NOW)
    ).toBe(0);
  });

  it('returns undefined for an unreadable result shape', async () => {
    const { db } = makeFakeDb({ affectedRows: 1 });
    expect(
      await markExpiredIfStale(db as never, 'c', 'a', 'confirmed', staleUpdatedAt, NOW)
    ).toBeUndefined();
  });

  it('skips the write entirely for unknown timestamps', async () => {
    const { db, chains } = makeFakeDb([{ affectedRows: 1 }, []]);
    expect(await markExpiredIfStale(db as never, 'c', 'a', 'confirmed', null, NOW)).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
    expect(chains).toHaveLength(0);
  });
});

describe('reclaimStuckProcessing', () => {
  const stuckUpdatedAt = new Date(NOW - PROCESSING_STUCK_MS - 5 * 60_000);

  it('issues the processing→confirmed reclaim CAS and returns affected rows', async () => {
    const { db, chains } = makeFakeDb([{ affectedRows: 1 }, []]);
    const affected = await reclaimStuckProcessing(
      db as never,
      '5bc350832943043e8a82',
      'alice',
      stuckUpdatedAt,
      NOW
    );
    expect(affected).toBe(1);
    expect(chains[0]!.set).toHaveBeenCalledWith({ status: 'confirmed' });
  });

  it('propagates a lost reclaim race as 0', async () => {
    const { db } = makeFakeDb([{ affectedRows: 0 }, []]);
    expect(
      await reclaimStuckProcessing(db as never, 'c', 'a', stuckUpdatedAt, NOW)
    ).toBe(0);
  });

  it('returns undefined for an unreadable result shape', async () => {
    const { db } = makeFakeDb(undefined);
    expect(
      await reclaimStuckProcessing(db as never, 'c', 'a', stuckUpdatedAt, NOW)
    ).toBeUndefined();
  });

  it('skips the write entirely for unknown timestamps (live claim is untouched)', async () => {
    const { db, chains } = makeFakeDb([{ affectedRows: 1 }, []]);
    expect(await reclaimStuckProcessing(db as never, 'c', 'a', undefined, NOW)).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
    expect(chains).toHaveLength(0);
  });
});
