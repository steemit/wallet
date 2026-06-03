// GET /.well-known/healthcheck.json
// Simple health check endpoint for ELB/OpenResty health monitoring.
// Matches the legacy wallet (Koa) healthcheck format.
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    docker_tag: process.env.DOCKER_TAG || false,
    source_commit: process.env.SOURCE_COMMIT || false,
  });
}
