import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { setCredentials } from '@/lib/store/slices/auth';

const recordRouteTag = vi.fn();
vi.mock('@/lib/analytics/overseer', () => ({
  recordRouteTag: (...args: unknown[]) => recordRouteTag(...args),
}));

vi.mock('@/i18n/routing', () => ({
  usePathname: () => mockPathname(),
}));

const mockPathname = vi.fn(() => '/market');

import { OverseerPageTracker } from '@/components/analytics/overseer-page-tracker';

function makeStore(loggedIn: boolean) {
  const store = configureStore({
    reducer: { auth: authReducer },
  });
  if (loggedIn) {
    store.dispatch(
      setCredentials({
        username: 'alice',
        postingKey: '5J',
      })
    );
  }
  return store;
}

describe('OverseerPageTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/market');
  });

  it('records the mapped route tag on mount', () => {
    render(
      <Provider store={makeStore(false)}>
        <OverseerPageTracker />
      </Provider>
    );
    expect(recordRouteTag).toHaveBeenCalledWith('market', undefined, false);
  });

  it('passes isLogin when authenticated', () => {
    // App-realistic account URL shape: every in-app account link is /@user/...
    mockPathname.mockReturnValue('/@alice/transfers');
    render(
      <Provider store={makeStore(true)}>
        <OverseerPageTracker />
      </Provider>
    );
    expect(recordRouteTag).toHaveBeenCalledWith(
      'user_index',
      { accountname: 'alice' },
      true
    );
  });
});
