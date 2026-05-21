import { type NextRequest } from 'next/server';
import { withRpcOverride } from '@/lib/steem/server';

// Nodes the UI may request — must be a subset of STEEM_RPC_URLS on the server.
const ALLOWED_NODES = (process.env.NEXT_PUBLIC_RPC_NODES || process.env.STEEM_RPC_URL || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

/**
 * Wraps a query handler so that a validated `X-Steem-RPC` request header is
 * honoured as the preferred (first-tried) RPC node for this request only.
 */
export function applyRpcOverride<T>(request: NextRequest, fn: () => Promise<T>): Promise<T> {
  const preferred = request.headers.get('x-steem-rpc') ?? '';
  if (preferred && ALLOWED_NODES.includes(preferred)) {
    return withRpcOverride(preferred, fn);
  }
  return fn();
}
