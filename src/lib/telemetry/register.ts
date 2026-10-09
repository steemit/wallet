/**
 * Node-runtime OpenTelemetry SDK setup.
 *
 * Fail-open: any initialization error is logged once and the process continues
 * without tracing. Export failures after startup are also rate-limited so a
 * missing collector cannot flood stdout the way jussi did in empty environments.
 *
 * Do not import `http`/`https` in this module — the HTTP instrumentation must
 * patch those modules before the OTLP exporter loads them.
 */

import { diag, DiagLogLevel, type DiagLogger } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  NodeTracerProvider,
} from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import {
  exporterHostForLog,
  loadTelemetryConfig,
  type TelemetryConfig,
} from './config';
import { FilteringSpanProcessor } from './filter-processor';
import {
  shouldIgnoreIncomingPath,
  shouldIgnoreOutgoingFetch,
  shouldIgnoreOutgoingHttp,
} from './ignore';

let started = false;
let provider: NodeTracerProvider | null = null;
let exportErrorLogged = false;

function createQuietDiagLogger(): DiagLogger {
  const report = (level: 'error' | 'warn', message: string): void => {
    const isExport =
      message.includes('OTLP') ||
      message.toLowerCase().includes('export') ||
      message.includes('ECONNREFUSED');
    if (isExport) {
      if (exportErrorLogged) return;
      exportErrorLogged = true;
      console.error(
        '[telemetry] trace export failed (further export errors suppressed):',
        message
      );
      return;
    }
    const log = level === 'error' ? console.error : console.warn;
    log(`[telemetry] ${message}`);
  };

  return {
    error: (message: string) => {
      report('error', message);
    },
    warn: (message: string) => {
      report('warn', message);
    },
    info: () => {},
    debug: () => {},
    verbose: () => {},
  };
}

function buildResource(config: TelemetryConfig) {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    ...config.resourceAttributes,
  });
}

function startSdk(config: TelemetryConfig): void {
  diag.setLogger(createQuietDiagLogger(), DiagLogLevel.ERROR);

  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) =>
          shouldIgnoreIncomingPath(request.url),
        ignoreOutgoingRequestHook: (options) =>
          shouldIgnoreOutgoingHttp(
            options.hostname ?? undefined,
            options.port ?? undefined,
            options.path ?? undefined,
            options.protocol ?? undefined,
            config.exporterUrl,
            typeof options.host === 'string' ? options.host : undefined
          ),
      }),
      new UndiciInstrumentation({
        ignoreRequestHook: (request) =>
          shouldIgnoreOutgoingFetch(
            request.origin,
            request.path,
            config.exporterUrl
          ),
      }),
    ],
  });

  const exporterOptions: { url: string; headers?: Record<string, string> } = {
    url: config.exporterUrl,
  };
  if (Object.keys(config.headers).length > 0) {
    exporterOptions.headers = config.headers;
  }

  // Filter health-probe spans (Next.js internals bypass HttpInstrumentation
  // ignoreIncomingRequestHook) before batching/export.
  const nextProvider = new NodeTracerProvider({
    resource: buildResource(config),
    spanProcessors: [
      new FilteringSpanProcessor(
        new BatchSpanProcessor(new OTLPTraceExporter(exporterOptions))
      ),
    ],
  });

  nextProvider.register({
    contextManager: new AsyncLocalStorageContextManager(),
    propagator: new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
  });

  provider = nextProvider;

  const flush = (): void => {
    void nextProvider.shutdown().catch(() => {
      // Best-effort flush on process exit.
    });
  };
  process.once('SIGTERM', flush);
  process.once('SIGINT', flush);
}

/**
 * Initialize tracing if configured. Returns true when the SDK is running.
 * Safe to call more than once.
 */
export async function registerTelemetry(): Promise<boolean> {
  if (started) return provider !== null;

  const config = loadTelemetryConfig();
  if (!config) return false;

  try {
    startSdk(config);
    started = true;
    console.info(
      '[telemetry] OpenTelemetry tracing initialized',
      JSON.stringify({
        service: config.serviceName,
        endpoint: exporterHostForLog(config.exporterUrl),
      })
    );
    return true;
  } catch (err) {
    started = true;
    console.error(
      '[telemetry] OpenTelemetry initialization failed; continuing without tracing:',
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/** Test-only: reset module state between cases. */
export function resetTelemetryState(): void {
  started = false;
  provider = null;
  exportErrorLogged = false;
}
