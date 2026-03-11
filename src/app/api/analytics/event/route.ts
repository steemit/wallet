// POST /api/analytics/event
// Server-side analytics event logging
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/middleware';

interface AnalyticsEventBody {
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting for analytics
    const rateLimitError = await rateLimit(request, 'analytics', {
      maxRequests: 100,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const body = await request.json() as AnalyticsEventBody;
    const { event, properties = {}, timestamp } = body;

    if (!event) {
      return NextResponse.json(
        { error: 'Missing event name' },
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
