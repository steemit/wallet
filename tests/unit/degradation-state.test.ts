import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDegraded, setDegraded, subscribeToDegradation } from '@/lib/cache/degradation-state';

describe('degradation-state', () => {
  afterEach(() => {
    setDegraded(false);
  });

  it('tracks global degraded state', () => {
    setDegraded(false);
    expect(isDegraded()).toBe(false);
    setDegraded(true);
    expect(isDegraded()).toBe(true);
  });

  it('notifies subscribers and supports unsubscribe', () => {
    setDegraded(false);
    const fn = vi.fn();
    const unsubscribe = subscribeToDegradation(fn);

    setDegraded(true);
    expect(fn).toHaveBeenCalledWith(true);

    fn.mockClear();
    unsubscribe();
    setDegraded(false);
    expect(fn).not.toHaveBeenCalled();
  });
});

