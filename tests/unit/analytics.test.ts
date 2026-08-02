/**
 * Analytics module unit tests
 *
 * Focus: every public tracker must POST to /api/analytics/event with the right
 * event name AND properties. The previous suite only asserted "fetch was called";
 * those tests passed even if the payload was wrong.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock mixpanel-browser BEFORE importing analytics module
vi.mock('mixpanel-browser', () => ({
  default: {
    init: vi.fn(),
    track: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    people: { set: vi.fn() },
  },
}));

import {
  trackEvent,
  trackPageView,
  trackLogin,
  trackLogout,
  trackTransfer,
  trackPowerDown,
  trackDelegate,
  trackWitnessVote,
  trackError,
  identifyUser,
  resetUser,
} from '@/lib/analytics';

global.fetch = vi.fn();

type AnalyticsPostBody = {
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
};

function lastFetchBody(): AnalyticsPostBody {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const last = calls[calls.length - 1] as [string, RequestInit];
  expect(last[0]).toBe('/api/analytics/event');
  expect(last[1]?.method).toBe('POST');
  return JSON.parse(last[1].body as string) as AnalyticsPostBody;
}

beforeEach(() => {
  vi.clearAllMocks();
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({ success: true }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('trackEvent (transport contract)', () => {
  it('POSTs event + properties + ISO timestamp to the analytics endpoint', async () => {
    await trackEvent('login_success', { username: 'alice' });
    const body = lastFetchBody();
    expect(body.event).toBe('login_success');
    expect(body.properties).toEqual({ username: 'alice' });
    expect(body).toHaveProperty('timestamp');
    expect(body.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('logs a JSON line to console in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await trackEvent('page_view', { page: '/wallet' });
    const logged = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(logged).toMatchObject({
      type: 'analytics',
      event: 'page_view',
      properties: { page: '/wallet' },
    });
  });

  it('swallows fetch errors so callers never throw', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network'));
    await expect(trackEvent('page_view', {})).resolves.toBeUndefined();
  });
});

describe('typed wrappers route to the correct event + payload', () => {
  it.each<{
    name: string;
    call: () => Promise<void>;
    event: string;
    properties: Record<string, unknown>;
  }>([
    {
      name: 'trackPageView',
      call: () => trackPageView('/wallet', 'alice', { locale: 'en' }),
      event: 'page_view',
      properties: { page: '/wallet', username: 'alice', locale: 'en' },
    },
    {
      name: 'trackLogin success',
      call: () => trackLogin('alice', true),
      event: 'login_success',
      properties: { username: 'alice' },
    },
    {
      name: 'trackLogin failure',
      call: () => trackLogin('alice', false, 'Invalid signature'),
      event: 'login_failure',
      properties: { username: 'alice', error: 'Invalid signature' },
    },
    {
      name: 'trackLogout',
      call: () => trackLogout('alice'),
      event: 'logout',
      properties: { username: 'alice' },
    },
    {
      name: 'trackTransfer success',
      call: () => trackTransfer('alice', '1.000 STEEM', 'bob', true),
      event: 'transfer_success',
      // PII (username, amount, recipient) is scrubbed — only success is tracked.
      properties: { success: true },
    },
    {
      name: 'trackTransfer failure',
      call: () => trackTransfer('alice', '1.000 STEEM', 'bob', false, 'Insufficient'),
      event: 'transfer_failure',
      properties: { success: false },
    },
    {
      name: 'trackPowerDown initiated',
      call: () => trackPowerDown('alice', '1.000000 VESTS', 'initiated'),
      event: 'power_down_initiated',
      // PII (username, amount) is scrubbed.
      properties: {},
    },
    {
      name: 'trackPowerDown cancelled',
      call: () => trackPowerDown('alice', '0.000000 VESTS', 'cancelled'),
      event: 'power_down_cancelled',
      properties: {},
    },
    {
      name: 'trackPowerDown success',
      call: () => trackPowerDown('alice', '1.000000 VESTS', 'success'),
      event: 'power_down_success',
      properties: {},
    },
    {
      name: 'trackPowerDown failure',
      call: () => trackPowerDown('alice', '1.000000 VESTS', 'failure', 'Invalid vests'),
      event: 'power_down_failure',
      properties: {},
    },
    {
      name: 'trackDelegate success',
      call: () => trackDelegate('alice', 'bob', '1.000000 VESTS', true),
      event: 'delegate_success',
      // PII (username, delegatee, amount) is scrubbed — only success is tracked.
      properties: { success: true },
    },
    {
      name: 'trackDelegate failure',
      call: () => trackDelegate('alice', 'bob', '1.000000 VESTS', false, 'Insufficient'),
      event: 'delegate_failure',
      properties: { success: false },
    },
    {
      name: 'trackWitnessVote vote',
      call: () => trackWitnessVote('alice', 'w1', true, true),
      event: 'witness_vote',
      properties: { username: 'alice', witness: 'w1', approve: true },
    },
    {
      name: 'trackWitnessVote unvote',
      call: () => trackWitnessVote('alice', 'w1', false, true),
      event: 'witness_unvote',
      properties: { username: 'alice', witness: 'w1', approve: false },
    },
    {
      name: 'trackWitnessVote failure',
      call: () => trackWitnessVote('alice', 'w1', true, false, 'Net err'),
      event: 'witness_vote_failure',
      properties: { username: 'alice', witness: 'w1', approve: true, error: 'Net err' },
    },
    {
      name: 'trackError with username',
      call: () => trackError('alice', 'network_error', 'Failed to fetch', { endpoint: '/x' }),
      event: 'error_occurred',
      properties: {
        username: 'alice',
        errorType: 'network_error',
        errorMessage: 'Failed to fetch',
        endpoint: '/x',
      },
    },
  ])('$name', async ({ call, event, properties }) => {
    await call();
    const body = lastFetchBody();
    expect(body.event).toBe(event);
    // Use objectContaining so undefined-valued optional fields don't break asserts.
    expect(body.properties).toEqual(expect.objectContaining(properties));
  });
});

describe('identifyUser / resetUser', () => {
  it('do not throw when mixpanel was never initialized', () => {
    expect(() => identifyUser('alice', { plan: 'free' })).not.toThrow();
    expect(() => resetUser()).not.toThrow();
  });
});
