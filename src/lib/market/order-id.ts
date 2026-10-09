/**
 * Unique limit-order ids for the internal market.
 *
 * The chain serializes `limit_order_create.orderid` / `limit_order_cancel.orderid`
 * as uint32 (max 4_294_967_295), and wallet-legacy used plain
 * `Math.floor(Date.now() / 1000)`, which fits uint32 but collides whenever two
 * orders are placed within the same second — the chain treats a repeated
 * (owner, orderid) as a REPLACE, so the second order silently overwrote the
 * first. Millisecond timestamps would be unique but overflow uint32, so derive
 * the id from `Date.now() % 2**32` (values repeat only every ~49.7 days — far
 * beyond the 27-day expiration this app sets on every order, so a still-open
 * order can never share an id with a fresh one) and keep a per-session
 * monotonic guard so same-millisecond orders never collide either.
 */
const UINT32_MAX = 4_294_967_295;

let lastOrderId = -1;
let wrapped = false;

/** Next unique order id; `nowMs` is injectable for tests. */
export function nextMarketOrderId(nowMs: number = Date.now()): number {
  const candidate = Math.floor(nowMs) % (UINT32_MAX + 1);
  if (!wrapped) {
    if (candidate > lastOrderId) {
      lastOrderId = candidate;
    } else {
      // Same millisecond or clock stepped back: bump past the last id.
      const next = Math.max(candidate, lastOrderId + 1);
      if (next > UINT32_MAX) {
        // Exhausted the whole uint32 range this session (~4.29e9 ids —
        // unreachable through the confirm-gated order form); wrap to 0 and
        // keep counting instead of revisiting time-derived values.
        wrapped = true;
        lastOrderId = 0;
      } else {
        lastOrderId = next;
      }
    }
  } else {
    lastOrderId = (lastOrderId + 1) % (UINT32_MAX + 1);
  }
  return lastOrderId;
}
