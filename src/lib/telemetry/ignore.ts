/**
 * Paths and destinations that must not create spans.
 *
 * Health probes (ELB / OpenResty / Docker HEALTHCHECK) would otherwise dominate
 * the trace stream. Outgoing calls to the OTLP collector must be ignored to
 * prevent an export-loop of traces about traces.
 *
 * Node `HttpInstrumentation.ignoreIncomingRequestHook` only skips the outer
 * HTTP server span. Next.js still emits framework spans (`HEAD /api/health`,
 * `executing api route (app) /api/health`, middleware, etc.). Those are dropped
 * in the FilteringSpanProcessor via {@link shouldDropHealthSpan}.
 */

export const IGNORED_INCOMING_PATHS = [
  '/api/health',
  '/.well-known/healthcheck.json',
] as const;

/** Attribute keys that may carry the request path on HTTP / Next spans. */
const PATH_ATTRIBUTE_KEYS = [
  'http.target',
  'url.path',
  'http.route',
  'http.url',
  'url.full',
] as const;

export function incomingPathname(url: string | undefined): string {
  if (!url) return '';
  try {
    if (url.includes('://')) {
      return new URL(url).pathname;
    }
  } catch {
    // Node IncomingMessage.url is path+query, not a full URL.
  }
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

export function shouldIgnoreIncomingPath(url: string | undefined): boolean {
  const path = incomingPathname(url);
  return IGNORED_INCOMING_PATHS.some((ignored) => path === ignored);
}

/**
 * Extract a pathname from span attributes (legacy `http.target` or stable
 * `url.path` / `http.route`). Returns '' when none are present.
 */
export function pathFromSpanAttributes(
  attributes: Record<string, unknown> | undefined
): string {
  if (!attributes) return '';
  for (const key of PATH_ATTRIBUTE_KEYS) {
    const value = attributes[key];
    if (typeof value !== 'string' || !value) continue;
    const path = incomingPathname(value);
    if (path) return path;
  }
  return '';
}

/**
 * True when a finished span is a health probe (by path attribute or span name).
 * Used by the filtering processor so Next.js internal spans do not fill OO.
 */
export function shouldDropHealthSpan(
  name: string,
  attributes: Record<string, unknown> | undefined
): boolean {
  if (shouldIgnoreIncomingPath(pathFromSpanAttributes(attributes))) {
    return true;
  }
  for (const ignored of IGNORED_INCOMING_PATHS) {
    if (name.includes(ignored)) return true;
  }
  return false;
}

function defaultPort(protocol: string, port: string): string {
  if (port) return port;
  return protocol === 'https:' ? '443' : '80';
}

function requestPort(
  protocol: string | undefined,
  port: string | number | undefined
): string {
  if (port !== undefined && port !== '') return String(port);
  return defaultPort(protocol ?? 'http:', '');
}

/**
 * Split `hostname` / `host` (which may be `host:port`) from Node RequestOptions.
 */
export function splitHostPort(
  hostname: string | undefined,
  host: string | undefined,
  port: string | number | undefined
): { hostname: string | undefined; port: string | number | undefined } {
  if (hostname) return { hostname, port };
  if (!host) return { hostname: undefined, port };
  const colon = host.lastIndexOf(':');
  if (colon > 0 && host.indexOf(':') === colon) {
    const parsedPort = host.slice(colon + 1);
    return {
      hostname: host.slice(0, colon),
      port: port !== undefined && port !== '' ? port : parsedPort,
    };
  }
  return { hostname: host, port };
}

/**
 * True when an outgoing Node `http` request is the OTLP exporter itself.
 */
export function shouldIgnoreOutgoingHttp(
  hostname: string | undefined,
  port: string | number | undefined,
  path: string | undefined,
  protocol: string | undefined,
  exporterUrl: string,
  host: string | undefined
): boolean {
  const split = splitHostPort(hostname, host, port);
  if (!exporterUrl || !split.hostname) return false;
  try {
    const exporter = new URL(exporterUrl);
    if (split.hostname !== exporter.hostname) return false;
    const reqPort = requestPort(protocol, split.port);
    const expPort = defaultPort(exporter.protocol, exporter.port);
    if (reqPort !== expPort) return false;
    return pathMatchesExporter(path ?? '/', exporter.pathname);
  } catch {
    return false;
  }
}

/**
 * True when an outgoing undici/`fetch` request is the OTLP exporter itself.
 */
export function shouldIgnoreOutgoingFetch(
  origin: string,
  path: string,
  exporterUrl: string
): boolean {
  if (!exporterUrl || !origin) return false;
  try {
    const exporter = new URL(exporterUrl);
    const request = new URL(path, origin);
    if (request.hostname !== exporter.hostname) return false;
    const reqPort = defaultPort(request.protocol, request.port);
    const expPort = defaultPort(exporter.protocol, exporter.port);
    if (reqPort !== expPort) return false;
    return pathMatchesExporter(request.pathname, exporter.pathname);
  } catch {
    return false;
  }
}

function pathMatchesExporter(requestPath: string, exporterPath: string): boolean {
  const normalizedExporter = exporterPath.replace(/\/$/, '') || '/';
  const normalizedRequest = requestPath || '/';
  return (
    normalizedRequest === normalizedExporter ||
    normalizedRequest.startsWith(`${normalizedExporter}/`)
  );
}
