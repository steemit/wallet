import { describe, expect, it } from 'vitest';
import {
  incomingPathname,
  pathFromSpanAttributes,
  shouldDropHealthSpan,
  shouldIgnoreIncomingPath,
  shouldIgnoreOutgoingFetch,
  shouldIgnoreOutgoingHttp,
  splitHostPort,
} from '@/lib/telemetry/ignore';

const EXPORTER = 'http://10.188.1.50:5080/api/default/v1/traces';

describe('shouldIgnoreIncomingPath', () => {
  it('ignores health probes with or without query strings', () => {
    expect(shouldIgnoreIncomingPath('/api/health')).toBe(true);
    expect(shouldIgnoreIncomingPath('/api/health?fresh=1')).toBe(true);
    expect(shouldIgnoreIncomingPath('/.well-known/healthcheck.json')).toBe(true);
  });

  it('does not ignore wallet API routes', () => {
    expect(shouldIgnoreIncomingPath('/api/broadcast/transfer')).toBe(false);
    expect(shouldIgnoreIncomingPath('/api/query/accounts')).toBe(false);
    expect(shouldIgnoreIncomingPath('/api/healthz')).toBe(false);
  });

  it('accepts a full URL from some runtimes', () => {
    expect(shouldIgnoreIncomingPath('http://127.0.0.1:8080/api/health')).toBe(
      true
    );
  });

  it('treats missing url as not ignored', () => {
    expect(shouldIgnoreIncomingPath(undefined)).toBe(false);
    expect(incomingPathname(undefined)).toBe('');
  });
});

describe('shouldDropHealthSpan', () => {
  it('drops spans whose http.target is a health path', () => {
    expect(
      shouldDropHealthSpan('GET', { 'http.target': '/.well-known/healthcheck.json' })
    ).toBe(true);
    expect(
      shouldDropHealthSpan('GET', { 'url.path': '/api/health' })
    ).toBe(true);
  });

  it('drops Next.js spans that embed the health path in the name', () => {
    expect(shouldDropHealthSpan('HEAD /api/health', {})).toBe(true);
    expect(
      shouldDropHealthSpan('executing api route (app) /api/health', undefined)
    ).toBe(true);
  });

  it('keeps normal API and page spans', () => {
    expect(
      shouldDropHealthSpan('GET', { 'http.target': '/api/query/accounts' })
    ).toBe(false);
    expect(shouldDropHealthSpan('middleware GET', {})).toBe(false);
    expect(shouldDropHealthSpan('start response', undefined)).toBe(false);
  });
});

describe('pathFromSpanAttributes', () => {
  it('prefers http.target then url.path', () => {
    expect(pathFromSpanAttributes({ 'http.target': '/api/health?x=1' })).toBe(
      '/api/health'
    );
    expect(pathFromSpanAttributes({ 'url.path': '/market' })).toBe('/market');
    expect(pathFromSpanAttributes({})).toBe('');
  });
});

describe('shouldIgnoreOutgoingHttp', () => {
  it('ignores the OTLP exporter host/path/port', () => {
    expect(
      shouldIgnoreOutgoingHttp(
        '10.188.1.50',
        5080,
        '/api/default/v1/traces',
        'http:',
        EXPORTER,
        undefined
      )
    ).toBe(true);
  });

  it('parses host:port when hostname is unset', () => {
    expect(
      shouldIgnoreOutgoingHttp(
        undefined,
        undefined,
        '/api/default/v1/traces',
        'http:',
        EXPORTER,
        '10.188.1.50:5080'
      )
    ).toBe(true);
  });

  it('does not ignore Steem RPC calls', () => {
    expect(
      shouldIgnoreOutgoingHttp(
        'api.steemitdev.com',
        443,
        '/',
        'https:',
        EXPORTER,
        undefined
      )
    ).toBe(false);
  });

  it('does not ignore a different port on the same host', () => {
    expect(
      shouldIgnoreOutgoingHttp(
        '10.188.1.50',
        4318,
        '/v1/traces',
        'http:',
        EXPORTER,
        undefined
      )
    ).toBe(false);
  });
});

describe('shouldIgnoreOutgoingFetch', () => {
  it('ignores undici origin+path aimed at the collector', () => {
    expect(
      shouldIgnoreOutgoingFetch(
        'http://10.188.1.50:5080',
        '/api/default/v1/traces',
        EXPORTER
      )
    ).toBe(true);
  });

  it('does not ignore jussi / steemd fetch', () => {
    expect(
      shouldIgnoreOutgoingFetch(
        'https://api.steemitdev.com',
        '/',
        EXPORTER
      )
    ).toBe(false);
  });
});

describe('splitHostPort', () => {
  it('prefers hostname over host', () => {
    expect(splitHostPort('example.com', 'ignored:9', 443)).toEqual({
      hostname: 'example.com',
      port: 443,
    });
  });

  it('splits host:port when hostname is missing', () => {
    expect(splitHostPort(undefined, '10.0.0.1:5080', undefined)).toEqual({
      hostname: '10.0.0.1',
      port: '5080',
    });
  });
});
