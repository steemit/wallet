'use client';

import { useSyncExternalStore, useCallback } from 'react';

const STORAGE_KEY = 'steem_rpc_node';

export const RPC_NODES: string[] = (process.env.NEXT_PUBLIC_RPC_NODES || 'https://api.steemit.com')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

const DEFAULT_NODE = RPC_NODES[0] ?? 'https://api.steemit.com';

// Module-level store — mirrors the theme store pattern.
let _node: string = DEFAULT_NODE;
const _listeners = new Set<() => void>();
function _notify() {
  _listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && RPC_NODES.includes(stored)) _node = stored;

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && e.newValue && RPC_NODES.includes(e.newValue)) {
      _node = e.newValue;
      _notify();
    }
  });
}

function _subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

export function getSelectedRpcNode(): string {
  return _node;
}

export function useRpcNode() {
  const node = useSyncExternalStore(_subscribe, () => _node, () => DEFAULT_NODE);

  const setNode = useCallback((url: string) => {
    if (!RPC_NODES.includes(url)) return;
    _node = url;
    localStorage.setItem(STORAGE_KEY, url);
    _notify();
  }, []);

  return { node, setNode, nodes: RPC_NODES };
}
