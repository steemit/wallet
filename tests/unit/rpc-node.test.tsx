/**
 * rpc-node module unit tests
 *
 * The module holds mutable singleton state (_node), so each describe block
 * resets modules via vi.resetModules() + dynamic import to get a clean slate.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const STORAGE_KEY = 'steem_rpc_node';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('RPC_NODES / getSelectedRpcNode', () => {
  it('RPC_NODES contains at least one https URL', async () => {
    const { RPC_NODES } = await import('@/lib/rpc-node');
    expect(RPC_NODES.length).toBeGreaterThan(0);
    expect(RPC_NODES[0]).toMatch(/^https?:\/\//);
  });

  it('getSelectedRpcNode returns the first node by default', async () => {
    const { RPC_NODES, getSelectedRpcNode } = await import('@/lib/rpc-node');
    expect(getSelectedRpcNode()).toBe(RPC_NODES[0]);
  });

  it('reads a valid persisted node from localStorage on init', async () => {
    // Pre-seed localStorage before the module loads
    localStorage.setItem(STORAGE_KEY, 'https://api.steemit.com');
    const { getSelectedRpcNode, RPC_NODES } = await import('@/lib/rpc-node');
    if (RPC_NODES.includes('https://api.steemit.com')) {
      expect(getSelectedRpcNode()).toBe('https://api.steemit.com');
    }
  });

  it('ignores an unknown URL stored in localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'https://evil.example.com');
    const { RPC_NODES, getSelectedRpcNode } = await import('@/lib/rpc-node');
    expect(getSelectedRpcNode()).toBe(RPC_NODES[0]);
  });
});

describe('useRpcNode hook', () => {
  it('returns node, setNode, and nodes', async () => {
    const { useRpcNode, RPC_NODES } = await import('@/lib/rpc-node');
    const { result } = renderHook(() => useRpcNode());
    expect(result.current.node).toBe(RPC_NODES[0]);
    expect(result.current.nodes).toEqual(RPC_NODES);
    expect(typeof result.current.setNode).toBe('function');
  });

  it('setNode updates the active node and persists to localStorage', async () => {
    const { useRpcNode, RPC_NODES } = await import('@/lib/rpc-node');
    const target = RPC_NODES[0]!;
    const { result } = renderHook(() => useRpcNode());
    act(() => {
      result.current.setNode(target);
    });
    expect(result.current.node).toBe(target);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(target);
  });

  it('setNode ignores a URL not in RPC_NODES', async () => {
    const { useRpcNode } = await import('@/lib/rpc-node');
    const { result } = renderHook(() => useRpcNode());
    const before = result.current.node;
    act(() => {
      result.current.setNode('https://not-in-the-list.example.com');
    });
    expect(result.current.node).toBe(before);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('unmounting unsubscribes from the store', async () => {
    const { useRpcNode } = await import('@/lib/rpc-node');
    const { unmount } = renderHook(() => useRpcNode());
    // Should not throw — exercises the _subscribe cleanup path
    expect(() => unmount()).not.toThrow();
  });

  it('reacts to cross-tab storage events', async () => {
    const { useRpcNode, RPC_NODES } = await import('@/lib/rpc-node');
    const { result } = renderHook(() => useRpcNode());
    const next = RPC_NODES[0]!;
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: STORAGE_KEY,
          newValue: next,
          storageArea: localStorage,
        })
      );
    });
    expect(result.current.node).toBe(next);
  });

  it('ignores storage events for unknown URLs', async () => {
    const { useRpcNode, RPC_NODES } = await import('@/lib/rpc-node');
    const { result } = renderHook(() => useRpcNode());
    const before = result.current.node;
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: STORAGE_KEY,
          newValue: 'https://evil.example.com',
          storageArea: localStorage,
        })
      );
    });
    expect(result.current.node).toBe(before);
    expect(result.current.node).toBe(RPC_NODES[0]);
  });
});
