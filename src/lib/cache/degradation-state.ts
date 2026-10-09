// Lightweight global state for tracking degraded responses
// Components can subscribe to show stale data indicators

type DegradationListener = (degraded: boolean) => void;

let listeners: DegradationListener[] = [];
let globalDegraded = false;

export function setDegraded(value: boolean): void {
  if (globalDegraded === value) return;
  globalDegraded = value;
  for (const fn of listeners) fn(value);
}

/**
 * Record the X-Degraded signal of one API response into this shared store.
 *
 * cachedFetch already does this for every response it sees; the raw fetch
 * getters in apiClient (getHistory, getWitnesses, getMarketData, ...) bypass
 * cachedFetch and used to rely on the 60s /api/health poll for the banner.
 * Calling this right after each response gives those pages the same
 * immediate degradation signal.
 */
export function noteResponseDegraded(res: Response): void {
  // Optional chaining: some unit-test fetch mocks omit `headers`; a real
  // Response always has them.
  setDegraded(res.headers?.get('X-Degraded') === 'true');
}

export function isDegraded(): boolean {
  return globalDegraded;
}

export function subscribeToDegradation(fn: DegradationListener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}
