// Providers store-binding test (A6-T1, round-1 review fix) — pins the
// composition contract that the EXACT store instance Providers creates and
// hands to redux <Provider> is also the one handed to the session key source
// (the vault runtime's legacy privateKey signer reads session keys through
// it). A probe child captures the store react-redux hands down; the session
// key source module is partially mocked so bindSessionKeyStore becomes an
// identity-assertable spy while every other export stays real.
//
// The StrictMode case exercises bind idempotence: dev StrictMode re-runs
// effects, so bind fires again with the SAME instance. The effect
// deliberately has NO cleanup (no unbind on unmount — Providers never
// unmounts in practice, and a StrictMode cleanup would open an unbound
// window between the simulated unmount and remount); accordingly the module
// exports no unbind at all, which is why this test never asserts one.
import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { useStore } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import type { AppStore, RootState } from '@/lib/store';

const bindSpy = vi.fn();
vi.mock('@/lib/auth/session-key-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session-key-source')>();
  return {
    ...actual,
    bindSessionKeyStore: (
      ...args: Parameters<typeof actual.bindSessionKeyStore>
    ): ReturnType<typeof actual.bindSessionKeyStore> => {
      bindSpy(...args);
      return actual.bindSessionKeyStore(...args);
    },
  };
});

/**
 * Capture the store react-redux hands to the tree below Providers. The probe
 * reports through an onStore PROP so the outer-scope write happens in
 * test-scope callbacks — the react-hooks lint rules forbid components from
 * reassigning or mutating values defined outside them.
 */
const captured: { current: AppStore | null } = { current: null };
function StoreProbe({ onStore }: { onStore: (store: AppStore) => void }) {
  onStore(useStore<RootState>() as AppStore);
  return null;
}

describe('Providers binds the app store into the session key source', () => {
  beforeEach(() => {
    bindSpy.mockClear();
    captured.current = null;
  });

  it('binds the exact store instance it passes to the redux Provider', () => {
    render(
      <Providers>
        <StoreProbe onStore={(store) => (captured.current = store)} />
      </Providers>,
    );
    expect(captured.current).not.toBeNull();
    expect(bindSpy).toHaveBeenCalledTimes(1);
    // Identity, not structure: the getter must read the live app store.
    expect(bindSpy.mock.calls[0]?.[0]).toBe(captured.current);
  });

  it('StrictMode double-mount rebinds the same instance (idempotent, never unbound)', () => {
    render(
      <StrictMode>
        <Providers>
          <StoreProbe onStore={(store) => (captured.current = store)} />
        </Providers>
      </StrictMode>,
    );
    expect(captured.current).not.toBeNull();
    // Dev StrictMode runs effects more than once; every call carries the one
    // store instance the tree actually uses (never a discarded initializer
    // result), and no unbind ever runs between the passes.
    expect(bindSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of bindSpy.mock.calls) {
      expect(call[0]).toBe(captured.current);
    }
  });
});
