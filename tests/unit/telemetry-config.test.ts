import { afterEach, describe, expect, it } from 'vitest';
import {
  buildExporterUrl,
  DEFAULT_OTLP_HTTP_PATH,
  DEFAULT_SERVICE_NAME,
  exporterHostForLog,
  loadTelemetryConfig,
  parseEnvFlag,
  parseKeyValueList,
} from '@/lib/telemetry/config';

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

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const key of TELEMETRY_ENV_KEYS) {
    snap[key] = process.env[key];
    delete process.env[key];
  }
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const key of TELEMETRY_ENV_KEYS) {
    const value = snap[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('parseEnvFlag', () => {
  it('parses common truthy and falsy strings', () => {
    expect(parseEnvFlag('true')).toBe(true);
    expect(parseEnvFlag('1')).toBe(true);
    expect(parseEnvFlag('YES')).toBe(true);
    expect(parseEnvFlag('on')).toBe(true);
    expect(parseEnvFlag('false')).toBe(false);
    expect(parseEnvFlag('0')).toBe(false);
    expect(parseEnvFlag('OFF')).toBe(false);
    expect(parseEnvFlag('no')).toBe(false);
  });

  it('returns undefined for empty or unknown values', () => {
    expect(parseEnvFlag(undefined)).toBeUndefined();
    expect(parseEnvFlag('')).toBeUndefined();
    expect(parseEnvFlag('maybe')).toBeUndefined();
  });
});

describe('parseKeyValueList', () => {
  it('parses comma-separated pairs and keeps equals in values', () => {
    expect(
      parseKeyValueList('Authorization=Basic abc==,X-Foo=bar')
    ).toEqual({
      Authorization: 'Basic abc==',
      'X-Foo': 'bar',
    });
  });

  it('skips empty and malformed pairs', () => {
    expect(parseKeyValueList('')).toEqual({});
    expect(parseKeyValueList('=novalue,ok=yes,')).toEqual({ ok: 'yes' });
  });
});

describe('buildExporterUrl', () => {
  it('adds the default traces path and port when given host:port', () => {
    expect(buildExporterUrl('jaeger:4318', '')).toBe(
      `http://jaeger:4318${DEFAULT_OTLP_HTTP_PATH}`
    );
  });

  it('uses an explicit OpenObserve path', () => {
    expect(
      buildExporterUrl('http://10.188.1.50:5080', '/api/default/v1/traces')
    ).toBe('http://10.188.1.50:5080/api/default/v1/traces');
  });

  it('keeps a path already on the endpoint when no explicit path is set', () => {
    expect(
      buildExporterUrl('http://collector:5080/api/default/v1/traces', '')
    ).toBe('http://collector:5080/api/default/v1/traces');
  });

  it('prefers explicitPath over a path on the endpoint', () => {
    expect(
      buildExporterUrl('http://collector:5080/old', '/api/default/v1/traces')
    ).toBe('http://collector:5080/api/default/v1/traces');
  });

  it('defaults the port to 4318 when omitted', () => {
    expect(buildExporterUrl('http://collector', '')).toBe(
      'http://collector:4318/v1/traces'
    );
  });

  it('returns empty string for an invalid URL', () => {
    expect(buildExporterUrl('http://', '')).toBe('');
  });
});

describe('loadTelemetryConfig', () => {
  let snap: Record<string, string | undefined>;

  afterEach(() => {
    restoreEnv(snap);
  });

  it('returns null when no endpoint is configured', () => {
    snap = snapshotEnv();
    expect(loadTelemetryConfig()).toBeNull();
  });

  it('returns null when OTEL_SDK_DISABLED is true even with an endpoint', () => {
    snap = snapshotEnv();
    process.env.WALLET_TELEMETRY_OTLP_ENDPOINT = 'http://collector:4318';
    process.env.OTEL_SDK_DISABLED = 'true';
    expect(loadTelemetryConfig()).toBeNull();
  });

  it('returns null when WALLET_TELEMETRY_ENABLED is false', () => {
    snap = snapshotEnv();
    process.env.WALLET_TELEMETRY_OTLP_ENDPOINT = 'http://collector:4318';
    process.env.WALLET_TELEMETRY_ENABLED = 'false';
    expect(loadTelemetryConfig()).toBeNull();
  });

  it('enables when only an endpoint is set (default off without endpoint)', () => {
    snap = snapshotEnv();
    process.env.WALLET_TELEMETRY_OTLP_ENDPOINT = 'http://10.188.1.50:5080';
    process.env.WALLET_TELEMETRY_OTLP_PATH = '/api/default/v1/traces';
    process.env.WALLET_TELEMETRY_OTLP_HEADERS =
      'Authorization=Basic dGVzdA==';
    process.env.WALLET_TELEMETRY_RESOURCE_ATTRIBUTES =
      'deployment.environment=dev';

    expect(loadTelemetryConfig()).toEqual({
      serviceName: DEFAULT_SERVICE_NAME,
      exporterUrl: 'http://10.188.1.50:5080/api/default/v1/traces',
      headers: { Authorization: 'Basic dGVzdA==' },
      resourceAttributes: { 'deployment.environment': 'dev' },
    });
  });

  it('prefers WALLET_TELEMETRY_* over standard OTEL_*', () => {
    snap = snapshotEnv();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel:4318';
    process.env.OTEL_SERVICE_NAME = 'from-otel';
    process.env.WALLET_TELEMETRY_OTLP_ENDPOINT = 'http://wallet-collector:5080';
    process.env.WALLET_TELEMETRY_SERVICE_NAME = 'wallet-dev';

    const config = loadTelemetryConfig();
    expect(config?.serviceName).toBe('wallet-dev');
    expect(config?.exporterUrl).toBe(
      'http://wallet-collector:5080/v1/traces'
    );
  });

  it('falls back to OTEL_EXPORTER_OTLP_TRACES_ENDPOINT including path', () => {
    snap = snapshotEnv();
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
      'http://oo:5080/api/default/v1/traces';
    const config = loadTelemetryConfig();
    expect(config?.exporterUrl).toBe(
      'http://oo:5080/api/default/v1/traces'
    );
  });
});

describe('exporterHostForLog', () => {
  it('returns host and path without credentials', () => {
    expect(
      exporterHostForLog('http://10.188.1.50:5080/api/default/v1/traces')
    ).toBe('10.188.1.50:5080/api/default/v1/traces');
  });

  it('handles an invalid URL', () => {
    expect(exporterHostForLog('not a url')).toBe('(invalid exporter url)');
  });
});
