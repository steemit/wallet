/**
 * Market order-id generation (G-14): the chain serializes orderid as uint32
 * and treats a repeated (owner, orderid) as a REPLACE — wallet-legacy (and
 * this app until now) used `Math.floor(Date.now() / 1000)`, so a second order
 * within the same second silently replaced the first. The helper must stay in
 * uint32 range AND never repeat within a session.
 */
import { describe, it, expect } from 'vitest';
import { nextMarketOrderId } from '@/lib/market/order-id';

const UINT32_MAX = 4_294_967_295;

describe('nextMarketOrderId', () => {
  it('stays within uint32 (chain serializer range)', () => {
    // A millisecond timestamp would overflow uint32 by ~3 orders of magnitude.
    for (let i = 0; i < 5; i++) {
      const id = nextMarketOrderId(Date.now());
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(UINT32_MAX);
      expect(Number.isInteger(id)).toBe(true);
    }
  });

  it('never repeats for calls in the same millisecond', () => {
    const ms = 1_790_000_000_000;
    const ids = new Set<number>();
    for (let i = 0; i < 100; i++) {
      ids.add(nextMarketOrderId(ms));
    }
    expect(ids.size).toBe(100);
  });

  it('orders placed in the same second no longer share an id', () => {
    const second = 1_790_000_123;
    const first = nextMarketOrderId(second * 1000);
    const secondOrder = nextMarketOrderId(second * 1000 + 500);
    expect(first).not.toBe(secondOrder);
  });

  it('is monotonic per session even when the clock steps back', () => {
    const a = nextMarketOrderId(2_000_000_000_000);
    const b = nextMarketOrderId(1_500_000_000_000); // clock stepped back
    const c = nextMarketOrderId(2_000_000_000_000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('keeps returning unique ids after exhausting the uint32 range', () => {
    // Feed a clock whose mod-2^32 residue sits right below uint32 max, then
    // force same-ms calls so the monotonic bump walks into the wrap.
    const nearMaxMs = UINT32_MAX - 2; // residue 4_294_967_293
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      seen.push(nextMarketOrderId(nearMaxMs));
    }
    expect(new Set(seen).size).toBe(seen.length);
    // Walked 4_294_967_293 → 4_294_967_295, wrapped to 0, then kept counting.
    expect(seen[0]).toBe(UINT32_MAX - 2);
    expect(seen[2]).toBe(UINT32_MAX);
    expect(seen[3]).toBe(0);
    expect(seen[4]).toBe(1);
  });
});
