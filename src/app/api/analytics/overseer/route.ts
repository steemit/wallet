// POST /api/analytics/overseer
// Relay frontend overseer.collect events (route tags + user actions).
// Shape/allowlist only — the chain-side overseer service is the sink.
import { NextRequest, NextResponse } from 'next/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { SteemService } from '@/lib/steem/server';
import {
  buildRoutePayload,
  buildUserActionPayload,
  isOverseerRouteTag,
  isOverseerUserAction,
  isSteemAccountName,
  isTrackingId,
  whaleThresholdsFromEnv,
  type UserActionParams,
} from '@/lib/analytics/overseer-payload';

const MAX_STRING = 64;
const MAX_AMOUNT = 1e15;

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_STRING) return undefined;
  return trimmed;
}

function asOptionalAccount(value: unknown): string | undefined {
  const s = asOptionalString(value);
  if (!s) return undefined;
  const name = s.replace(/^@/, '').toLowerCase();
  return isSteemAccountName(name) ? name : undefined;
}

function asOptionalAmount(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_AMOUNT) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_STRING) return undefined;
    const n = parseFloat(trimmed.split(' ')[0] ?? '');
    if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return undefined;
    return trimmed;
  }
  return undefined;
}

function sanitizeActionParams(raw: unknown): UserActionParams {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const params: UserActionParams = {};
  const username = asOptionalAccount(o.username);
  const from = asOptionalAccount(o.from);
  const to = asOptionalAccount(o.to);
  const witness = asOptionalAccount(o.witness);
  // Proxy may be empty string (clear proxy). Allow '' or a valid account.
  let proxy: string | undefined;
  if (typeof o.proxy === 'string') {
    const p = o.proxy.trim().replace(/^@/, '').toLowerCase();
    if (p === '') proxy = '';
    else if (isSteemAccountName(p)) proxy = p;
  }
  const transferCoin = asOptionalString(o.transferCoin);
  const amount = asOptionalAmount(o.amount);
  if (username !== undefined) params.username = username;
  if (from !== undefined) params.from = from;
  if (to !== undefined) params.to = to;
  if (witness !== undefined) params.witness = witness;
  if (proxy !== undefined) params.proxy = proxy;
  if (transferCoin !== undefined) params.transferCoin = transferCoin;
  if (amount !== undefined) params.amount = amount;
  return params;
}

export async function POST(request: NextRequest) {
  try {
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'analytics', {
      maxRequests: 100,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const body = (await request.json()) as Record<string, unknown>;
    const kind = body.kind;

    if (kind === 'route') {
      const tag = typeof body.tag === 'string' ? body.tag : '';
      const trackingId = typeof body.trackingId === 'string' ? body.trackingId : '';
      if (!isOverseerRouteTag(tag) || !isTrackingId(trackingId)) {
        return NextResponse.json({ error: 'Invalid route event' }, { status: 400 });
      }
      const accountname = asOptionalAccount(
        body.params && typeof body.params === 'object'
          ? (body.params as Record<string, unknown>).accountname
          : undefined
      );
      const payload = buildRoutePayload(
        trackingId,
        tag,
        accountname ? { accountname } : undefined,
        body.isLogin === true
      );
      await SteemService.collectOverseer(payload);
      return NextResponse.json({ success: true });
    }

    if (kind === 'action') {
      const action = typeof body.action === 'string' ? body.action : '';
      if (!isOverseerUserAction(action)) {
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
      }
      const payload = buildUserActionPayload(
        action,
        sanitizeActionParams(body.params),
        whaleThresholdsFromEnv()
      );
      await SteemService.collectOverseer(payload);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid event kind' }, { status: 400 });
  } catch (error) {
    console.error('Overseer analytics error:', error);
    return NextResponse.json({ success: true });
  }
}
