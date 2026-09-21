/**
 * MarketPageClient broadcast error capture (G-7): placeOrder previously had
 * no try/catch at all (a signing throw = unhandled rejection, zero user
 * feedback) and cancelOrder had try/finally without a catch (spin indicator
 * reset but the rejection still escaped). Both paths must surface a toast the
 * way every other broadcast flow does, and the orderid handed to the chain
 * must be a per-session unique uint32 (G-14) instead of a seconds timestamp
 * whose same-second repeat silently REPLACED the previous order.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { MarketPageClient } from '@/components/market/market-page-client';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue(undefined),
  signCreate: vi.fn(),
  signCancel: vi.fn(),
  broadcastCreate: vi.fn(),
  broadcastCancel: vi.fn(),
  invalidate: vi.fn(),
  auth: { username: 'alice' as string | null, isAuthenticated: true },
}));

// jsdom lacks ResizeObserver (recharts ResponsiveContainer in the depth chart).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    username: mocks.auth.username,
    isAuthenticated: mocks.auth.isAuthenticated,
  }),
  useActiveSigningKey: () =>
    mocks.auth.isAuthenticated ? '5J-test-active' : null,
}));

vi.mock('@/hooks/use-steem-account', () => ({
  useSteemAccount: () => ({
    data: { balance: '100.000 STEEM', sbd_balance: '100.000 SBD' },
  }),
}));

vi.mock('@/hooks/use-market-data', () => ({
  useMarketData: () => ({
    orderbook: { bids: [], asks: [] },
    ticker: {
      latest: 1,
      lowest_ask: 1,
      highest_bid: 1,
      percent_change: 0,
      steem_volume: 0,
      sbd_volume: 0,
    },
    history: [],
    openOrders: [
      { orderid: 42, created: '2026-01-01T00:00:00', type: 'bid', steem: 1, sbd: 1, price: 1 },
    ],
    loading: false,
    error: null,
    refresh: mocks.refresh,
  }),
}));

vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    signLimitOrderCreate: (...args: unknown[]) => mocks.signCreate(...args),
    signLimitOrderCancel: (...args: unknown[]) => mocks.signCancel(...args),
  },
  apiClient: {
    broadcastLimitOrderCreate: (...args: unknown[]) => mocks.broadcastCreate(...args),
    broadcastLimitOrderCancel: (...args: unknown[]) => mocks.broadcastCancel(...args),
  },
}));

vi.mock('@/lib/cache/client-invalidate', () => ({
  invalidateWalletCache: mocks.invalidate,
}));

vi.mock('@/components/auth/login-form', () => ({
  // Expose the success callback so the dialog wiring is exercisable.
  LoginForm: ({ onLoginSuccess }: { onLoginSuccess?: () => void }) =>
    onLoginSuccess ? (
      <button type="button" onClick={onLoginSuccess}>
        stub-login-success
      </button>
    ) : null,
}));

const mockToast = toast as unknown as {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

const UINT32_MAX = 4_294_967_295;

/** Fill the buy form (price auto-seeds from the ticker) and submit. */
async function placeBuyOrder() {
  fireEvent.change(screen.getAllByLabelText('amount')[0]!, {
    target: { value: '5' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'buySteem' }));
}

describe('MarketPageClient — order error capture (G-7) + orderid (G-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces a signing failure as a toast instead of an unhandled rejection', async () => {
    mocks.signCreate.mockRejectedValueOnce(new Error('signing boom'));
    render(<MarketPageClient />);

    await placeBuyOrder();

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('orderFailed');
    });
    // The broadcast was never attempted and the signing key was not consumed.
    expect(mocks.broadcastCreate).not.toHaveBeenCalled();
  });

  it('surfaces a relay failure ({success:false}) as a toast', async () => {
    mocks.signCreate.mockResolvedValueOnce({ id: 'tx' });
    mocks.broadcastCreate.mockResolvedValueOnce({ success: false, error: 'relay rejected' });
    render(<MarketPageClient />);

    await placeBuyOrder();

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('relay rejected');
    });
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('success path: unique uint32 orderids, cache invalidation, refresh', async () => {
    mocks.signCreate.mockResolvedValue({ id: 'tx' });
    mocks.broadcastCreate.mockResolvedValue({ success: true });
    render(<MarketPageClient />);

    await placeBuyOrder();
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('orderPlaced'));

    await placeBuyOrder();
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledTimes(2));

    const firstId = mocks.signCreate.mock.calls[0]?.[3] as number;
    const secondId = mocks.signCreate.mock.calls[1]?.[3] as number;
    // signLimitOrderCreate(owner, amountToSell, minToReceive, orderid, ...)
    expect(firstId).not.toBe(secondId);
    for (const id of [firstId, secondId]) {
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(UINT32_MAX);
    }
    expect(mocks.invalidate).toHaveBeenCalledWith('alice');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('cancel: signing failure surfaces a toast and releases the spinner', async () => {
    mocks.signCancel.mockRejectedValueOnce(new Error('cancel signing boom'));
    render(<MarketPageClient />);

    fireEvent.click(screen.getByRole('button', { name: 'cancelOrder' }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('orderFailed');
    });
    expect(mocks.broadcastCancel).not.toHaveBeenCalled();
    // cancellingId reset by the finally block — button is interactive again.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'cancelOrder' })).not.toBeDisabled();
    });
  });

  it('cancel: relay failure surfaces the relay error', async () => {
    mocks.signCancel.mockResolvedValueOnce({ id: 'tx' });
    mocks.broadcastCancel.mockResolvedValueOnce({ success: false, error: 'rate limited' });
    render(<MarketPageClient />);

    fireEvent.click(screen.getByRole('button', { name: 'cancelOrder' }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('rate limited');
    });
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('cancel: success path still works (toast + invalidation + refresh)', async () => {
    mocks.signCancel.mockResolvedValueOnce({ id: 'tx' });
    mocks.broadcastCancel.mockResolvedValueOnce({ success: true });
    render(<MarketPageClient />);

    fireEvent.click(screen.getByRole('button', { name: 'cancelOrder' }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('orderCancelled');
    });
    expect(mocks.invalidate).toHaveBeenCalledWith('alice');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('sell orders take the price-warning branch and succeed with a unique orderid', async () => {
    mocks.signCreate.mockResolvedValue({ id: 'tx' });
    mocks.broadcastCreate.mockResolvedValue({ success: true });
    render(<MarketPageClient />);

    // Far below the highest bid (1) -> priceWarningBelow confirm text.
    fireEvent.change(screen.getAllByLabelText('price')[1]!, { target: { value: '0.1' } });
    fireEvent.change(screen.getAllByLabelText('amount')[1]!, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'sellSteem' }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('orderPlaced');
    });
    const sellOrderid = mocks.signCreate.mock.calls.at(-1)?.[3] as number;
    expect(sellOrderid).toBeLessThanOrEqual(UINT32_MAX);
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('does nothing when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MarketPageClient />);

    await placeBuyOrder();
    fireEvent.click(screen.getByRole('button', { name: 'cancelOrder' }));

    expect(mocks.signCreate).not.toHaveBeenCalled();
    expect(mocks.signCancel).not.toHaveBeenCalled();
  });

  it('anonymous users get the sign-in prompt, login dialog, and no order attempt', async () => {
    mocks.auth.username = null;
    mocks.auth.isAuthenticated = false;
    try {
      render(<MarketPageClient />);

      // Sign-in prompt with an inline login trigger.
      fireEvent.click(screen.getByRole('button', { name: 'login' }));
      // Dialog renders the (stubbed) form; its success closes the dialog.
      fireEvent.click(screen.getByRole('button', { name: 'stub-login-success' }));

      // The order form is disabled for anonymous users.
      expect(screen.getByRole('button', { name: 'buySteem' })).toBeDisabled();
      expect(mocks.signCreate).not.toHaveBeenCalled();
    } finally {
      mocks.auth.username = 'alice';
      mocks.auth.isAuthenticated = true;
    }
  });
});
