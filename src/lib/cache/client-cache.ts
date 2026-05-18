// Browser-side LRU cache with stale-while-revalidate support
// Module-level singleton shared across all imports within the same tab

const MAX_ENTRIES = 50;

interface CacheEntry<T> {
  data: T;
  staleAt: number;
  expiresAt: number;
}

class ClientCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private insertionOrder: string[] = [];

  get<T>(key: string): { data: T; stale: boolean } | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.store.delete(key);
      this.removeFromOrder(key);
      return null;
    }

    return { data: entry.data as T, stale: now > entry.staleAt };
  }

  set<T>(key: string, data: T, staleMs: number, maxAgeMs: number): void {
    // Evict oldest entries if at capacity
    if (!this.store.has(key) && this.store.size >= MAX_ENTRIES) {
      const oldest = this.insertionOrder.shift();
      if (oldest) this.store.delete(oldest);
    }

    const now = Date.now();
    this.store.set(key, {
      data,
      staleAt: now + staleMs,
      expiresAt: now + maxAgeMs,
    });

    // Track insertion order
    if (!this.insertionOrder.includes(key)) {
      this.insertionOrder.push(key);
    }
  }

  invalidate(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.includes(prefix)) {
        this.store.delete(key);
        this.removeFromOrder(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
    this.insertionOrder = [];
  }

  private removeFromOrder(key: string): void {
    const idx = this.insertionOrder.indexOf(key);
    if (idx !== -1) this.insertionOrder.splice(idx, 1);
  }
}

export const clientCache = new ClientCache();
