/**
 * Analytics module unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock mixpanel-browser BEFORE importing analytics module
vi.mock('mixpanel-browser', () => ({
  default: {
    init: vi.fn(),
    track: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    people: {
      set: vi.fn(),
    },
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
  type AnalyticsEvent,
} from '@/lib/analytics';

// Mock fetch
global.fetch = vi.fn();

describe('Analytics Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set development mode to enable console logging
    process.env.NODE_ENV = 'development';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('trackEvent', () => {
    it('should log event to console in development', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      await trackEvent('page_view', { page: '/wallet', username: 'testuser' });

      const loggedValue = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(loggedValue).toMatchObject({
        type: 'analytics',
        event: 'page_view',
        properties: { page: '/wallet', username: 'testuser' },
      });
      expect(loggedValue.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp format
    });

    it('should send event to server-side analytics endpoint', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackEvent('login_success', { username: 'testuser' });

      expect(fetchSpy).toHaveBeenCalledWith('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('login_success'),
      });
    });

    it('should handle fetch errors gracefully', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      // Should not throw
      await expect(trackEvent('page_view', {})).resolves.toBeUndefined();
    });
  });

  describe('trackPageView', () => {
    it('should track page view event', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackPageView('/wallet', 'testuser', { locale: 'en' });

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('trackLogin', () => {
    it('should track successful login', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackLogin('testuser', true);

      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should track failed login', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackLogin('testuser', false, 'Invalid signature');

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('trackLogout', () => {
    it('should track logout event', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackLogout('testuser');

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('trackTransfer', () => {
    it('should track successful transfer', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackTransfer('testuser', '1.000 STEEM', 'recipient', true);

      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should track failed transfer', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackTransfer('testuser', '1.000 STEEM', 'recipient', false, 'Insufficient balance');

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('trackPowerDown', () => {
    it('should track power down initiated', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackPowerDown('testuser', '1000000.000000 VESTS', 'initiated');

      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should track power down cancelled', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackPowerDown('testuser', '0.000000 VESTS', 'cancelled');

      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should track power down success', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackPowerDown('testuser', '1000000.000000 VESTS', 'success');

      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should track power down failure', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackPowerDown('testuser', '1000000.000000 VESTS', 'failure', 'Invalid vests');

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('trackDelegate', () => {
    it('should track successful delegation', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackDelegate('testuser', 'delegatee', '1000000.000000 VESTS', true);

      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should track failed delegation', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackDelegate('testuser', 'delegatee', '1000000.000000 VESTS', false, 'Insufficient vests');

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('trackWitnessVote', () => {
    it('should track witness vote', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackWitnessVote('testuser', 'witness', true, true);

      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should track witness unvote', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackWitnessVote('testuser', 'witness', false, true);

      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should track witness vote failure', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackWitnessVote('testuser', 'witness', true, false, 'Network error');

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('trackError', () => {
    it('should track error event', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackError(
        'testuser',
        'network_error',
        'Failed to fetch',
        { endpoint: '/api/query/accounts' }
      );

      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should track error without username', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await trackError(undefined, 'validation_error', 'Invalid input');

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('identifyUser and resetUser', () => {
    it('should not throw when mixpanel is not available', () => {
      // These functions should not throw even if mixpanel is not initialized
      expect(() => identifyUser('testuser', { name: 'Test User' })).not.toThrow();
      expect(() => resetUser()).not.toThrow();
    });
  });
});
