/**
 * Analytics service for tracking user events
 * Supports Mixpanel integration
 */

// Event types for wallet operations
export type AnalyticsEvent =
  | 'page_view'
  | 'login_attempt'
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'transfer_initiated'
  | 'transfer_success'
  | 'transfer_failure'
  | 'power_down_initiated'
  | 'power_down_success'
  | 'power_down_cancelled'
  | 'power_down_failure'
  | 'delegate_initiated'
  | 'delegate_success'
  | 'delegate_failure'
  | 'witness_vote'
  | 'witness_unvote'
  | 'witness_vote_failure'
  | 'account_viewed'
  | 'error_occurred';

export interface AnalyticsProperties {
  [key: string]: string | number | boolean | undefined;
}

// Mixpanel integration (client-side only)
interface MixpanelInstance {
  track: (event: string, properties?: Record<string, unknown>) => void;
  identify: (userId: string) => void;
  people: {
    set: (props: Record<string, unknown>) => void;
  };
  reset: () => void;
  init: (token: string, config?: Record<string, unknown>) => void;
}

let mixpanelInstance: MixpanelInstance | null = null;

/**
 * Initialize Mixpanel
 * Call this once on app startup (client-side)
 */
export function initAnalytics() {
  if (typeof window === 'undefined') return;

  const token = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
  if (!token) return;

  // Dynamic import for Mixpanel (only on client)
  // @ts-expect-error - Optional dependency, installed when Mixpanel is enabled
  import('mixpanel-browser').then((mixpanel) => {
    mixpanelInstance = mixpanel.default as unknown as MixpanelInstance;
    mixpanelInstance.init(token, {
      debug: process.env.NODE_ENV === 'development',
      track_pageview: true,
      persistence: 'localStorage',
    });
  }).catch(() => {
    // Mixpanel not available, silently fail
  });
}

/**
 * Track an analytics event
 */
export async function trackEvent(
  eventName: AnalyticsEvent,
  properties: AnalyticsProperties = {}
): Promise<void> {
  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log(JSON.stringify({
      type: 'analytics',
      event: eventName,
      properties,
      timestamp: new Date().toISOString(),
    }));
  }

  // Send to Mixpanel if available
  if (mixpanelInstance && typeof window !== 'undefined') {
    try {
      mixpanelInstance.track(eventName, properties);
    } catch (error) {
      console.error('Analytics error:', error);
    }
  }

  // Send to server-side analytics endpoint (for backup)
  try {
    await fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: eventName,
        properties,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Silently fail for analytics errors
  }
}

/**
 * Identify a user
 */
export function identifyUser(userId: string, traits?: AnalyticsProperties): void {
  if (!mixpanelInstance || typeof window === 'undefined') return;

  try {
    mixpanelInstance.identify(userId);
    if (traits) {
      mixpanelInstance.people.set(traits);
    }
  } catch {
    // Silently fail
  }
}

/**
 * Reset user tracking (on logout)
 */
export function resetUser(): void {
  if (!mixpanelInstance || typeof window === 'undefined') return;

  try {
    mixpanelInstance.reset();
  } catch {
    // Silently fail
  }
}

/**
 * Track page views
 */
export async function trackPageView(
  page: string,
  username?: string,
  properties?: AnalyticsProperties
): Promise<void> {
  await trackEvent('page_view', {
    page,
    username,
    ...properties,
  });
}

/**
 * Track authentication events
 */
export async function trackLogin(username: string, success: boolean, error?: string): Promise<void> {
  if (success) {
    await trackEvent('login_success', { username });
  } else {
    await trackEvent('login_failure', { username, error });
  }
}

export async function trackLogout(username: string): Promise<void> {
  await trackEvent('logout', { username });
  resetUser();
}

/**
 * Track transfer events
 */
export async function trackTransfer(
  username: string,
  amount: string,
  recipient: string,
  success: boolean,
  error?: string
): Promise<void> {
  const eventName = success
    ? 'transfer_success'
    : 'transfer_failure';

  await trackEvent(eventName, {
    username,
    amount,
    recipient,
    error,
  });
}

/**
 * Track power down events
 */
export async function trackPowerDown(
  username: string,
  amount: string,
  action: 'initiated' | 'cancelled' | 'success' | 'failure',
  error?: string
): Promise<void> {
  const eventMap: Record<string, AnalyticsEvent> = {
    initiated: 'power_down_initiated',
    cancelled: 'power_down_cancelled',
    success: 'power_down_success',
    failure: 'power_down_failure',
  };

  const eventName = eventMap[action];
  if (!eventName) return;

  await trackEvent(eventName, {
    username,
    amount,
    error,
  });
}

/**
 * Track delegation events
 */
export async function trackDelegate(
  username: string,
  delegatee: string,
  amount: string,
  success: boolean,
  error?: string
): Promise<void> {
  const eventName = success
    ? 'delegate_success'
    : 'delegate_failure';

  await trackEvent(eventName, {
    username,
    delegatee,
    amount,
    error,
  });
}

/**
 * Track witness vote events
 */
export async function trackWitnessVote(
  username: string,
  witness: string,
  approve: boolean,
  success: boolean,
  error?: string
): Promise<void> {
  const eventName = success
    ? approve ? 'witness_vote' : 'witness_unvote'
    : 'witness_vote_failure';

  await trackEvent(eventName, {
    username,
    witness,
    approve,
    error,
  });
}

/**
 * Track errors
 */
export async function trackError(
  username: string | undefined,
  errorType: string,
  errorMessage: string,
  context?: AnalyticsProperties
): Promise<void> {
  await trackEvent('error_occurred', {
    username,
    errorType,
    errorMessage,
    ...context,
  });
}
