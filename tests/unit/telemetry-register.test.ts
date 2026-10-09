import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  registerMock,
  shutdownMock,
  setLoggerMock,
  registerInstrumentationsMock,
  resourceFromAttributesMock,
  providerConfigs,
} = vi.hoisted(() => ({
  registerMock: vi.fn(),
  shutdownMock: vi.fn().mockResolvedValue(undefined),
  setLoggerMock: vi.fn(),
  registerInstrumentationsMock: vi.fn(),
  resourceFromAttributesMock: vi.fn().mockReturnValue({ attributes: {} }),
  providerConfigs: [] as unknown[],
}));

vi.mock('@opentelemetry/api', () => ({
  diag: { setLogger: (...args: unknown[]) => setLoggerMock(...args) },
  DiagLogLevel: { ERROR: 1 },
}));

vi.mock('@opentelemetry/context-async-hooks', () => ({
  AsyncLocalStorageContextManager: class {},
}));

vi.mock('@opentelemetry/core', () => ({
  CompositePropagator: class {},
  W3CBaggagePropagator: class {},
  W3CTraceContextPropagator: class {},
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {
    url: string;
    constructor(opts: { url: string }) {
      this.url = opts.url;
    }
  },
}));

vi.mock('@opentelemetry/instrumentation', () => ({
  registerInstrumentations: (...args: unknown[]) =>
    registerInstrumentationsMock(...args),
}));

vi.mock('@opentelemetry/instrumentation-http', () => ({
  HttpInstrumentation: class {
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
    }
  },
}));

vi.mock('@opentelemetry/instrumentation-undici', () => ({
  UndiciInstrumentation: class {
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
    }
  },
}));

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: (...args: unknown[]) =>
    resourceFromAttributesMock(...args),
}));

vi.mock('@opentelemetry/sdk-trace-node', () => ({
  BatchSpanProcessor: class {
    constructor(public readonly exporter: unknown) {}
  },
  NodeTracerProvider: class {
    constructor(public readonly config: unknown) {
      providerConfigs.push(config);
    }
    register(...args: unknown[]) {
      registerMock(...args);
    }
    shutdown() {
      return shutdownMock();
    }
  },
}));

vi.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
}));

const TELEMETRY_ENV_KEYS = [
  'OTEL_SDK_DISABLED',
  'WALLET_TELEMETRY_ENABLED',
  'WALLET_TELEMETRY_OTLP_ENDPOINT',
  'WALLET_TELEMETRY_OTLP_PATH',
  'WALLET_TELEMETRY_OTLP_HEADERS',
  'WALLET_TELEMETRY_SERVICE_NAME',
  'WALLET_TELEMETRY_RESOURCE_ATTRIBUTES',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_SERVICE_NAME',
  'OTEL_RESOURCE_ATTRIBUTES',
] as const;

describe('registerTelemetry', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    registerMock.mockClear();
    registerInstrumentationsMock.mockClear();
    setLoggerMock.mockClear();
    providerConfigs.length = 0;
    for (const key of TELEMETRY_ENV_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of TELEMETRY_ENV_KEYS) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('is a no-op when telemetry is not configured', async () => {
    const { registerTelemetry } = await import('@/lib/telemetry/register');
    await expect(registerTelemetry()).resolves.toBe(false);
    expect(registerMock).not.toHaveBeenCalled();
    expect(registerInstrumentationsMock).not.toHaveBeenCalled();
  });

  it('registers the SDK when an OTLP endpoint is set', async () => {
    process.env.WALLET_TELEMETRY_OTLP_ENDPOINT = 'http://10.188.1.50:5080';
    process.env.WALLET_TELEMETRY_OTLP_PATH = '/api/default/v1/traces';
    process.env.WALLET_TELEMETRY_SERVICE_NAME = 'wallet';

    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { registerTelemetry } = await import('@/lib/telemetry/register');
    await expect(registerTelemetry()).resolves.toBe(true);
    expect(registerInstrumentationsMock).toHaveBeenCalledOnce();
    expect(registerMock).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it('does not initialize twice', async () => {
    process.env.WALLET_TELEMETRY_OTLP_ENDPOINT = 'http://collector:4318';
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { registerTelemetry } = await import('@/lib/telemetry/register');
    await expect(registerTelemetry()).resolves.toBe(true);
    await expect(registerTelemetry()).resolves.toBe(true);
    expect(registerMock).toHaveBeenCalledOnce();
  });

  it('continues without tracing when SDK construction throws', async () => {
    process.env.WALLET_TELEMETRY_OTLP_ENDPOINT = 'http://collector:4318';
    registerInstrumentationsMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { registerTelemetry } = await import('@/lib/telemetry/register');
    await expect(registerTelemetry()).resolves.toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('wires health-check and collector ignore hooks', async () => {
    process.env.WALLET_TELEMETRY_OTLP_ENDPOINT = 'http://10.188.1.50:5080';
    process.env.WALLET_TELEMETRY_OTLP_PATH = '/api/default/v1/traces';
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const { registerTelemetry } = await import('@/lib/telemetry/register');
    await registerTelemetry();

    const call = registerInstrumentationsMock.mock.calls[0]?.[0] as {
      instrumentations: Array<{ config: Record<string, unknown> }>;
    };
    const httpConfig = call.instrumentations[0]?.config as {
      ignoreIncomingRequestHook: (req: { url?: string }) => boolean;
      ignoreOutgoingRequestHook: (opts: {
        hostname?: string;
        port?: number;
        path?: string;
        protocol?: string;
      }) => boolean;
    };
    const undiciConfig = call.instrumentations[1]?.config as {
      ignoreRequestHook: (req: { origin: string; path: string }) => boolean;
    };

    expect(httpConfig.ignoreIncomingRequestHook({ url: '/api/health' })).toBe(
      true
    );
    expect(
      httpConfig.ignoreIncomingRequestHook({ url: '/api/broadcast/transfer' })
    ).toBe(false);
    expect(
      httpConfig.ignoreOutgoingRequestHook({
        hostname: '10.188.1.50',
        port: 5080,
        path: '/api/default/v1/traces',
        protocol: 'http:',
      })
    ).toBe(true);
    expect(
      undiciConfig.ignoreRequestHook({
        origin: 'https://api.steemitdev.com',
        path: '/',
      })
    ).toBe(false);

    const { FilteringSpanProcessor } = await import(
      '@/lib/telemetry/filter-processor'
    );
    const providerConfig = providerConfigs[0] as {
      spanProcessors: unknown[];
    };
    expect(providerConfig.spanProcessors).toHaveLength(1);
    expect(providerConfig.spanProcessors[0]).toBeInstanceOf(
      FilteringSpanProcessor
    );
  });

  it('suppresses repeated OTLP export errors', async () => {
    process.env.WALLET_TELEMETRY_OTLP_ENDPOINT = 'http://collector:4318';
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { registerTelemetry } = await import('@/lib/telemetry/register');
    await registerTelemetry();

    const logger = setLoggerMock.mock.calls[0]?.[0] as {
      error: (message: string) => void;
      warn: (message: string) => void;
      info: () => void;
    };
    logger.error('OTLP exporter failed: connect ECONNREFUSED');
    logger.error('OTLP exporter failed: connect ECONNREFUSED');
    logger.warn('unrelated warning');
    logger.info();

    const exportLogs = error.mock.calls.filter((c) =>
      String(c[0]).includes('further export errors suppressed')
    );
    expect(exportLogs).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });
});
