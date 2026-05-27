import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/middleware';

export async function POST(request: NextRequest) {
  const rateLimitError = await rateLimit(request, 'query', { maxRequests: 10, windowSeconds: 60 });
  if (rateLimitError) return rateLimitError;

  const body = (await request.json()) as {
    contact_email?: string;
    account_name?: string;
    owner_key?: string;
  };

  if (!body.contact_email || !body.account_name || !body.owner_key) {
    return NextResponse.json({ status: 'error', error: 'Missing fields' }, { status: 400 });
  }

  // Compatibility shim until backend email service is wired (legacy: initiate_account_recovery_with_email).
  return NextResponse.json({ status: 'ok' });
}
