import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { FilteringSpanProcessor } from '@/lib/telemetry/filter-processor';

function makeSpan(opts: {
  name: string;
  spanId: string;
  traceId?: string;
  parentSpanId?: string;
  attributes?: Record<string, unknown>;
}): ReadableSpan {
  const traceId = opts.traceId ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  return {
    name: opts.name,
    attributes: opts.attributes ?? {},
    spanContext: () => ({
      traceId,
      spanId: opts.spanId,
      traceFlags: 1,
    }),
    ...(opts.parentSpanId
      ? {
          parentSpanContext: {
            traceId,
            spanId: opts.parentSpanId,
            traceFlags: 1,
          },
        }
      : {}),
  } as unknown as ReadableSpan;
}

function mockDelegate() {
  return {
    onStart: vi.fn(),
    onEnd: vi.fn(),
    onEnding: vi.fn(),
    forceFlush: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

describe('FilteringSpanProcessor', () => {
  it('forwards business spans to the delegate', () => {
    const delegate = mockDelegate();
    const processor = new FilteringSpanProcessor(
      delegate as unknown as SpanProcessor
    );
    const span = makeSpan({
      name: 'GET',
      spanId: '1111111111111111',
      attributes: { 'http.target': '/api/query/accounts' },
    });
    processor.onEnd(span);
    expect(delegate.onEnd).toHaveBeenCalledWith(span);
  });

  it('drops health spans identified by http.target', () => {
    const delegate = mockDelegate();
    const processor = new FilteringSpanProcessor(
      delegate as unknown as SpanProcessor
    );
    processor.onEnd(
      makeSpan({
        name: 'GET',
        spanId: '2222222222222222',
        attributes: { 'http.target': '/.well-known/healthcheck.json' },
      })
    );
    expect(delegate.onEnd).not.toHaveBeenCalled();
  });

  it('drops Next.js spans that name the health route', () => {
    const delegate = mockDelegate();
    const processor = new FilteringSpanProcessor(
      delegate as unknown as SpanProcessor
    );
    processor.onEnd(
      makeSpan({
        name: 'HEAD /api/health',
        spanId: '3333333333333333',
      })
    );
    processor.onEnd(
      makeSpan({
        name: 'executing api route (app) /api/health',
        spanId: '4444444444444444',
      })
    );
    expect(delegate.onEnd).not.toHaveBeenCalled();
  });

  it('drops descendants of a dropped health span (same parent)', () => {
    const delegate = mockDelegate();
    const processor = new FilteringSpanProcessor(
      delegate as unknown as SpanProcessor
    );
    const parentId = '5555555555555555';
    processor.onEnd(
      makeSpan({
        name: 'HEAD /api/health',
        spanId: parentId,
        traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      })
    );
    processor.onEnd(
      makeSpan({
        name: 'start response',
        spanId: '6666666666666666',
        parentSpanId: parentId,
        traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      })
    );
    expect(delegate.onEnd).not.toHaveBeenCalled();
  });

  it('drops later spans on a dropped health trace even without parent link', () => {
    const delegate = mockDelegate();
    const processor = new FilteringSpanProcessor(
      delegate as unknown as SpanProcessor
    );
    const traceId = 'cccccccccccccccccccccccccccccccc';
    processor.onEnd(
      makeSpan({
        name: 'GET',
        spanId: '7777777777777777',
        traceId,
        attributes: { 'http.target': '/api/health' },
      })
    );
    processor.onEnd(
      makeSpan({
        name: 'middleware GET',
        spanId: '8888888888888888',
        traceId,
      })
    );
    expect(delegate.onEnd).not.toHaveBeenCalled();
  });

  it('forwards onStart / forceFlush / shutdown to the delegate', async () => {
    const delegate = mockDelegate();
    const processor = new FilteringSpanProcessor(
      delegate as unknown as SpanProcessor
    );
    const span = {} as Span;
    const ctx = {} as Context;
    processor.onStart(span, ctx);
    processor.onEnding(span);
    await processor.forceFlush();
    await processor.shutdown();
    expect(delegate.onStart).toHaveBeenCalledWith(span, ctx);
    expect(delegate.onEnding).toHaveBeenCalledWith(span);
    expect(delegate.forceFlush).toHaveBeenCalledOnce();
    expect(delegate.shutdown).toHaveBeenCalledOnce();
  });
});
