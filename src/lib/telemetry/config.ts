/**
 * OpenTelemetry configuration for the wallet Node runtime.
 *
 * Tracing is opt-in: with no OTLP endpoint the SDK is never initialized, so
 * local/dev without a collector does not flood logs. Explicit
 * WALLET_TELEMETRY_ENABLED=false or OTEL_SDK_DISABLED=true always wins.
 *
 * Env names follow jussi/conveyor (service-prefixed) and also honor the
 * standard OTEL_* variables as fallbacks.
 */

export const DEFAULT_SERVICE_NAME = 'wallet';
export const DEFAULT_OTLP_HTTP_PATH = '/v1/traces';
export const DEFAULT_OTLP_HTTP_PORT = '4318';

export type TelemetryConfig = {
  serviceName: string;
  exporterUrl: string;
  headers: Record<string, string>;
  resourceAttributes: Record<string, string>;
};

function trimEnv(value: string | undefined): string {
  return value?.trim() ?? '';
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = trimEnv(value);
    if (trimmed) return trimmed;
  }
  return '';
}

/**
 * Parse `true`/`false`/`1`/`0`/`on`/`off`/`yes`/`no`. Empty or unknown → undefined.
 */
export function parseEnvFlag(value: string | undefined): boolean | undefined {
  const trimmed = trimEnv(value).toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === '1' || trimmed === 'true' || trimmed === 'yes' || trimmed === 'on') {
    return true;
  }
  if (trimmed === '0' || trimmed === 'false' || trimmed === 'no' || trimmed === 'off') {
    return false;
  }
  return undefined;
}

/**
 * Parse `Key=Value,Key2=Value2`. Values may contain `=` (e.g. Basic auth).
 */
export function parseKeyValueList(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw.trim()) return out;
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Build a full OTLP/HTTP traces URL.
 *
 * `endpoint` may be `host:port`, `http(s)://host[:port]`, or a URL that already
 * includes a path. `explicitPath` (WALLET_TELEMETRY_OTLP_PATH) wins over a path
 * on the endpoint; otherwise a URL path is kept; otherwise `/v1/traces`.
 */
export function buildExporterUrl(endpoint: string, explicitPath: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return '';
  const withScheme = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return '';
  }
  if (!parsed.port) {
    parsed.port = DEFAULT_OTLP_HTTP_PORT;
  }
  const fromUrl = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
  const path = explicitPath.trim() || fromUrl || DEFAULT_OTLP_HTTP_PATH;
  parsed.pathname = path.startsWith('/') ? path : `/${path}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export function loadTelemetryConfig(
  env: NodeJS.Dict<string> = process.env
): TelemetryConfig | null {
  if (parseEnvFlag(env.OTEL_SDK_DISABLED) === true) return null;
  if (parseEnvFlag(env.WALLET_TELEMETRY_ENABLED) === false) return null;

  const endpoint = firstNonEmpty(
    env.WALLET_TELEMETRY_OTLP_ENDPOINT,
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    env.OTEL_EXPORTER_OTLP_ENDPOINT
  );
  if (!endpoint) return null;

  const explicitPath = firstNonEmpty(env.WALLET_TELEMETRY_OTLP_PATH);
  const exporterUrl = buildExporterUrl(endpoint, explicitPath);
  if (!exporterUrl) return null;

  const serviceName =
    firstNonEmpty(env.WALLET_TELEMETRY_SERVICE_NAME, env.OTEL_SERVICE_NAME) ||
    DEFAULT_SERVICE_NAME;

  const headers = parseKeyValueList(
    firstNonEmpty(env.WALLET_TELEMETRY_OTLP_HEADERS, env.OTEL_EXPORTER_OTLP_HEADERS)
  );
  const resourceAttributes = parseKeyValueList(
    firstNonEmpty(
      env.WALLET_TELEMETRY_RESOURCE_ATTRIBUTES,
      env.OTEL_RESOURCE_ATTRIBUTES
    )
  );

  return { serviceName, exporterUrl, headers, resourceAttributes };
}

/** Hostname (no credentials) for logs — never print OTLP headers. */
export function exporterHostForLog(exporterUrl: string): string {
  try {
    const parsed = new URL(exporterUrl);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return '(invalid exporter url)';
  }
}
