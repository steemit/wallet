/**
 * SpanProcessor that drops health-probe spans (and their descendants) before
 * they reach the OTLP exporter.
 *
 * HttpInstrumentation already skips creating the outer HTTP server span for
 * /api/health and /.well-known/healthcheck.json, but Next.js still emits
 * framework spans for those routes. Without this filter they dominate OpenObserve.
 */

import type { Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-node';

import { shouldDropHealthSpan } from './ignore';

/** Cap remembered drop markers so a long-running process cannot grow unbounded. */
const DEFAULT_MAX_MARKERS = 4096;

export type FilteringSpanProcessorOptions = {
  /** Max span/trace IDs to remember for descendant dropping. */
  maxMarkers?: number;
};

export class FilteringSpanProcessor implements SpanProcessor {
  private readonly droppedSpanIds = new Set<string>();
  private readonly droppedTraceIds = new Set<string>();
  private readonly markerOrder: string[] = [];
  private readonly maxMarkers: number;

  constructor(
    private readonly delegate: SpanProcessor,
    options: FilteringSpanProcessorOptions = {}
  ) {
    this.maxMarkers = options.maxMarkers ?? DEFAULT_MAX_MARKERS;
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  onStart(span: Span, parentContext: Context): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnding(span: Span): void {
    this.delegate.onEnding?.(span);
  }

  onEnd(span: ReadableSpan): void {
    const ctx = span.spanContext();
    const parentId = span.parentSpanContext?.spanId;
    const drop =
      shouldDropHealthSpan(span.name, span.attributes as Record<string, unknown>) ||
      (parentId !== undefined && this.droppedSpanIds.has(parentId)) ||
      this.droppedTraceIds.has(ctx.traceId);

    if (drop) {
      this.rememberDrop(ctx.spanId, ctx.traceId);
      return;
    }

    this.delegate.onEnd(span);
  }

  shutdown(): Promise<void> {
    this.droppedSpanIds.clear();
    this.droppedTraceIds.clear();
    this.markerOrder.length = 0;
    return this.delegate.shutdown();
  }

  private rememberDrop(spanId: string, traceId: string): void {
    this.addMarker(this.droppedSpanIds, `s:${spanId}`);
    this.addMarker(this.droppedTraceIds, `t:${traceId}`);
  }

  private addMarker(set: Set<string>, key: string): void {
    const bare = key.slice(2);
    if (set.has(bare)) return;
    set.add(bare);
    this.markerOrder.push(key);
    while (this.markerOrder.length > this.maxMarkers) {
      const oldest = this.markerOrder.shift();
      if (!oldest) break;
      const id = oldest.slice(2);
      if (oldest.startsWith('s:')) this.droppedSpanIds.delete(id);
      else this.droppedTraceIds.delete(id);
    }
  }
}
