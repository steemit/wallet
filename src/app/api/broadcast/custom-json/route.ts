// POST /api/broadcast/custom-json
// Broadcast signed custom_json operations (community hivemind ops, subscribe, etc.)
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit, setCacheInvalidateHeader } from '@/lib/middleware';
import type { SignedTransaction } from '@/lib/steem/types';
import { validateRelayTransaction } from '@/lib/steem/validate-signed-tx-op';

// Allowlist of permitted custom_json `id` values. Without this the route relays
// arbitrary app payloads, which is a flexible abuse channel. Extend this set as
// new legitimate use cases appear.
const ALLOWED_CUSTOM_JSON_IDS = new Set([
  'community', // community/hivemind ops used by this app
  'follow',    // follow/mute/reblog (standard Steem social ops)
  'reblog',    // legacy reblog id
]);

// custom_json id format: lowercase alnum + underscore/dot/dash, max 32 chars.
const CUSTOM_JSON_ID_RE = /^[a-z0-9_.-]{1,32}$/;

export async function POST(request: NextRequest) {
  try {
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'broadcast', {
      maxRequests: 10,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const body = await request.json();
    const { signedTx, username } = body as { signedTx: SignedTransaction; username: string };

    if (!signedTx || !username) {
      return NextResponse.json(
        { error: 'Missing signed transaction or username' },
        { status: 400 }
      );
    }

    // Validate transaction: enforce op type AND cryptographically verify the
    // signature belongs to the claimed account (requires @steemit/steem-js >=1.0.20).
    const relayError = await validateRelayTransaction(signedTx, 'custom_json', username);
    if (relayError) return relayError;


    // Validate the custom_json payload: enforce an allowlist of `id` values and
    // structural sanity so the relay is not an open arbitrary-payload channel.
    const opBody = signedTx.operations[0]?.[1] as {
      id?: unknown;
      json?: unknown;
      required_posting_auths?: unknown;
      required_auths?: unknown;
    } | undefined;
    const cjId = typeof opBody?.id === 'string' ? opBody.id : '';
    if (!cjId || !CUSTOM_JSON_ID_RE.test(cjId)) {
      return NextResponse.json({ error: 'Invalid custom_json id' }, { status: 400 });
    }
    if (!ALLOWED_CUSTOM_JSON_IDS.has(cjId)) {
      return NextResponse.json({ error: 'Disallowed custom_json id' }, { status: 400 });
    }
    // `json` must be a JSON-serializable string (the signed payload).
    if (typeof opBody?.json !== 'string' || opBody.json.length > 8192) {
      return NextResponse.json({ error: 'Invalid custom_json payload' }, { status: 400 });
    }

    const result = await SteemService.broadcastTransaction(signedTx);

    const response = NextResponse.json({ success: true, result });
    setCacheInvalidateHeader(response, username);
    return response;
  } catch (error) {
    console.error('Broadcast custom-json error:', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}
