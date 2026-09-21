/**
 * RecentActivity rendering — covers the component shell (loading / empty /
 * error / rows) around the (separately tested) row formatting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecentActivity } from '@/components/wallet/recent-activity';
import type { SteemHistoryItem } from '@/lib/wallet/normalize-history';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, _opts?: unknown) => key,
}));

let lazyEnabled = true;
vi.mock('@/hooks/use-lazy-enabled', () => ({
  useLazyEnabled: () => lazyEnabled,
}));

let activityState: {
  history: SteemHistoryItem[];
  loading: boolean;
  loadingMore: boolean;
  exhausted: boolean;
  totalFetched: number;
  error: string | null;
  loadMore: () => Promise<void>;
};
vi.mock('@/lib/wallet/use-activity-history', () => ({
  useActivityHistory: () => activityState,
}));

let pagerState: {
  page: SteemHistoryItem[];
  canGoNewer: boolean;
  canGoOlder: boolean;
  onNewer: () => void;
  onOlder: () => void;
  loadingOlder: boolean;
  canFetchMore: boolean;
};
vi.mock('@/lib/wallet/use-rewards-history-pager', () => ({
  useRewardsHistoryPager: () => pagerState,
}));

const transferItem = (i: number): SteemHistoryItem => ({
  op: ['transfer', { from: 'bob', to: 'alice', amount: '1.000 STEEM', memo: 'memo ' + i }],
  timestamp: '2026-09-01T10:00:00',
  block: 1000000 + i,
  trx_id: 'trx-' + i,
  index: i,
});

function setState(overrides: Partial<typeof activityState> = {}, history: SteemHistoryItem[] = []) {
  activityState = {
    history,
    loading: false,
    loadingMore: false,
    exhausted: false,
    totalFetched: history.length,
    error: null,
    loadMore: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function setPager(page: SteemHistoryItem[], canFetchMore = false) {
  pagerState = {
    page,
    canGoNewer: false,
    canGoOlder: true,
    onNewer: vi.fn(),
    onOlder: vi.fn(),
    loadingOlder: false,
    canFetchMore,
  };
}

describe('RecentActivity', () => {
  beforeEach(() => {
    lazyEnabled = true;
  });

  it('renders nothing before lazy activation', () => {
    lazyEnabled = false;
    setState({}, [transferItem(1)]);
    setPager([transferItem(1)]);
    const { container } = render(
      <RecentActivity username="alice" globalProps={null} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders skeleton rows while loading', () => {
    setState({ loading: true });
    setPager([]);
    const { container } = render(<RecentActivity username="alice" />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('renders nothing when history is empty and exhausted', () => {
    setState({ exhausted: true });
    setPager([], false);
    const { container } = render(<RecentActivity username="alice" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders formatted rows', () => {
    const items = [transferItem(1), transferItem(2)];
    setState({}, items);
    setPager(items, true);
    render(<RecentActivity username="Alice" />);

    // Both transfer rows share the same description text.
    expect(screen.getAllByText('Received 1.000 STEEM from bob')).toHaveLength(2);
    expect(screen.getByText('memo 1')).toBeInTheDocument();
    expect(screen.queryByText('activityNoMatchesHint')).not.toBeInTheDocument();
  });

  it('shows the no-matches hint when nothing matched but more history exists', () => {
    setState({ totalFetched: 50 });
    setPager([], true);
    render(<RecentActivity username="alice" />);
    expect(screen.getByText('activityNoMatchesHint')).toBeInTheDocument();
  });

  it('surfaces fetch errors with the retry hint', () => {
    const items = [transferItem(1)];
    setState({ error: 'Request Timeout', totalFetched: 1 }, items);
    setPager(items, true);
    render(<RecentActivity username="alice" />);
    expect(screen.getByText('activityFetchError')).toBeInTheDocument();
  });
});
