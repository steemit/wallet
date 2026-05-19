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

export function isDegraded(): boolean {
  return globalDegraded;
}

export function subscribeToDegradation(fn: DegradationListener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}
