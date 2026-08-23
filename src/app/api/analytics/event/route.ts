// POST /api/analytics/event
// Server-side analytics event logging
import { NextRequest, NextResponse } from 'next/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';

interface AnalyticsEventBody {
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
}

// S7: bounds on unauthenticated (CSRF-token-only) log writes — without them
// an attacker can push arbitrary-size lines into the server log.
const MAX_EVENT_NAME = 64;
const MAX_PROPERTIES_BYTES = 2048;
const MAX_PROPERTY_KEYS = 16;

export async function POST(request: NextRequest) {
  try {
    // CSRF: analytics is a write endpoint (logs), so require a token to prevent
    // cross-site log injection / pollution.
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    // Rate limiting for analytics
    const rateLimitError = await rateLimit(request, 'analytics', {
      maxRequests: 100,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const body = await request.json() as AnalyticsEventBody;
    const { event, properties = {}, timestamp } = body;

    if (!event || typeof event !== 'string') {
      return NextResponse.json(
        { error: 'Missing event name' },
        { status: 400 }
      );
    }

    // S7: length/format caps on the event name and property payload before
    // they reach the log sink.
    if (event.length > MAX_EVENT_NAME || !/^[\w.:-]+$/.test(event)) {
      return NextResponse.json(
        { error: 'Invalid event name' },
        { status: 400 }
      );
    }
    if (
      Object.keys(properties).length > MAX_PROPERTY_KEYS ||
      JSON.stringify(properties).length > MAX_PROPERTIES_BYTES
    ) {
      return NextResponse.json(
        { error: 'Invalid properties' },
        { status: 400 }
      );
    }

    // Log analytics event (can be sent to external service later)
    console.log(JSON.stringify({
      type: 'analytics',
      event,
      properties,
      timestamp: timestamp || new Date().toISOString(),
      ip: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    }));

    // Here you could also send to:
    // - Database (for long-term storage)
    // - Mixpanel HTTP API
    // - Other analytics services

    return NextResponse.json({ success: true });
  } catch (error) {
    // Silently fail for analytics errors - don't break user experience
    console.error('Analytics error:', error);
    return NextResponse.json({ success: true }); // Always return success
  }
}
