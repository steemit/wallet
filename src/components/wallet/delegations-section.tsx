'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useActiveSigningKey } from '@/hooks/use-auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { useVestingDelegations, useExpiringVestingDelegations } from '@/hooks/use-delegations';
import {
  formatSteemPowerFromVestsString,
  STEEM_POWER_TICKER,
} from '@/lib/wallet/vest-steem';
import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import { formatTimeAgo } from '@/lib/wallet/format-time-ago';
import { useLocale } from 'next-intl';
import type { GlobalPropsData } from '@/lib/wallet/wallet-balance-types';
import type { VestingDelegation, ExpiringVestingDelegation } from '@/lib/steem/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowUpDown, Search, ChevronLeft, ChevronRight } from 'lucide-react';

type SortField = 'delegatee' | 'date' | 'amount';
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 20;

function formatSpDisplay(
  vestsAsset: string,
  globalProps: GlobalPropsData | null
): string {
  if (globalProps) {
    return `${formatSteemPowerFromVestsString(vestsAsset, globalProps)} ${STEEM_POWER_TICKER}`;
  }
  const n = parseAssetAmount(vestsAsset);
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 6 })} VESTS`;
}

export function DelegationsSection({
  username,
  globalProps,
  globalPropsLoading,
  isMyAccount,
}: {
  username: string;
  globalProps: GlobalPropsData | null;
  globalPropsLoading: boolean;
  isMyAccount: boolean;
}) {
  const t = useTranslations('wallet');
  const [activeTab, setActiveTab] = useState<'outgoing' | 'expiring'>('outgoing');

  const outgoing = useVestingDelegations(username);
  const expiring = useExpiringVestingDelegations(username);

  const isLoading = activeTab === 'outgoing' ? outgoing.loading : expiring.loading;
  const activeError = activeTab === 'outgoing' ? outgoing.error : expiring.error;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab buttons */}
      <div className="flex gap-2">
        <Button
          variant={activeTab === 'outgoing' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('outgoing')}
        >
          {t('outgoingDelegations')}
        </Button>
        <Button
          variant={activeTab === 'expiring' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('expiring')}
        >
          {t('expiringDelegations')}
        </Button>
      </div>

      <Separator />

      {activeError && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4">
          <p className="text-sm text-destructive font-medium">{activeError}</p>
        </div>
      )}

      {activeTab === 'outgoing' ? (
        <OutgoingDelegationsTable
          delegations={outgoing.delegations}
          globalProps={globalProps}
          globalPropsLoading={globalPropsLoading}
          isMyAccount={isMyAccount}
          username={username}
          onRevoked={outgoing.refetch}
        />
      ) : (
        <ExpiringDelegationsTable
          delegations={expiring.delegations}
          globalProps={globalProps}
          globalPropsLoading={globalPropsLoading}
        />
      )}
    </div>
  );
}

/* ───────── Outgoing Delegations ───────── */

function OutgoingDelegationsTable({
  delegations,
  globalProps,
  globalPropsLoading,
  isMyAccount,
  username,
  onRevoked,
}: {
  delegations: VestingDelegation[];
  globalProps: GlobalPropsData | null;
  globalPropsLoading: boolean;
  isMyAccount: boolean;
  username: string;
  onRevoked: () => void;
}) {
  const t = useTranslations('wallet');
  const tc = useTranslations('common');
  const locale = useLocale();
  const signingKey = useActiveSigningKey();

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('delegatee');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
      setPage(1);
    },
    [sortField]
  );

  const filtered = useMemo(() => {
    let items = delegations;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter((d) => d.delegatee.toLowerCase().includes(q));
    }
    return items;
  }, [delegations, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      switch (sortField) {
        case 'delegatee':
          return dir * a.delegatee.localeCompare(b.delegatee);
        case 'date':
          return (
            dir *
            (new Date(a.min_delegation_time).getTime() -
              new Date(b.min_delegation_time).getTime())
          );
        case 'amount':
          return (
            dir *
            (parseAssetAmount(a.vesting_shares) - parseAssetAmount(b.vesting_shares))
          );
        default:
          return 0;
      }
    });
    return copy;
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleRevoke = async () => {
    if (!revokeTarget || !signingKey || !username) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const signedTx = await SteemSigner.signDelegate(
        username,
        revokeTarget,
        '0.000000 VESTS',
        signingKey
      );
      const res = await apiClient.broadcastDelegate(signedTx, username);
      if (!res.success) {
        setRevokeError(res.error || t('revokeFailed'));
        return;
      }
      setRevokeTarget(null);
      onRevoked();
    } catch (err) {
      setRevokeError((err as Error).message);
    } finally {
      setRevoking(false);
    }
  };

  const closeRevokeDialog = () => {
    if (!revoking) setRevokeTarget(null);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  if (delegations.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4">{t('noOutgoingDelegations')}</div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t('searchDelegations')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="pl-9"
        />
      </div>

      {/* Count */}
      <div className="text-sm text-muted-foreground">
        {t('delegationCount', { count: filtered.length })}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('delegatee')}
                >
                  {t('delegatee')} <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('date')}
                >
                  {t('startDate')} <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('amount')}
                >
                  {t('amountDelegated')} <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              {isMyAccount && <TableHead className="w-[100px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((item) => (
              <TableRow key={`${item.delegatee}-${item.min_delegation_time}`}>
                <TableCell className="font-medium">
                  <a
                    href={`/@${item.delegatee}`}
                    className="text-primary hover:underline"
                  >
                    {item.delegatee}
                  </a>
                </TableCell>
                <TableCell
                  className="cursor-pointer text-muted-foreground"
                  onClick={() => copyToClipboard(item.min_delegation_time)}
                  title={item.min_delegation_time}
                >
                  {formatTimeAgo(item.min_delegation_time, locale)}
                </TableCell>
                <TableCell
                  className="cursor-pointer text-right"
                  onClick={() =>
                    copyToClipboard(
                      globalProps
                        ? `${formatSteemPowerFromVestsString(item.vesting_shares, globalProps)} SP`
                        : item.vesting_shares
                    )
                  }
                  title={formatSpDisplay(item.vesting_shares, globalProps)}
                >
                  {globalPropsLoading ? (
                    <Skeleton className="ml-auto h-4 w-20" />
                  ) : globalProps ? (
                    `${formatSteemPowerFromVestsString(item.vesting_shares, globalProps)} SP`
                  ) : (
                    item.vesting_shares
                  )}
                </TableCell>
                {isMyAccount && (
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRevokeTarget(item.delegatee)}
                      disabled={revoking}
                    >
                      {t('revoke')}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Cards */}
      <div className="space-y-2 md:hidden">
        {paged.map((item) => (
          <div
            key={`${item.delegatee}-${item.min_delegation_time}`}
            className="flex flex-col gap-1 rounded-lg border p-3"
          >
            <div className="flex items-center justify-between">
              <a
                href={`/@${item.delegatee}`}
                className="font-medium text-primary hover:underline"
              >
                {item.delegatee}
              </a>
              {isMyAccount && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRevokeTarget(item.delegatee)}
                  disabled={revoking}
                >
                  {t('revoke')}
                </Button>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {formatTimeAgo(item.min_delegation_time, locale)}
            </div>
            <div
              className="cursor-pointer text-sm font-medium"
              onClick={() =>
                copyToClipboard(
                  globalProps
                    ? `${formatSteemPowerFromVestsString(item.vesting_shares, globalProps)} SP`
                    : item.vesting_shares
                )
              }
            >
              {globalPropsLoading
                ? '...'
                : globalProps
                  ? `${formatSteemPowerFromVestsString(item.vesting_shares, globalProps)} SP`
                  : item.vesting_shares}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="icon"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Revoke confirmation dialog */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && closeRevokeDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('revokeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('revokeDescription', { delegatee: revokeTarget ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revokeError && (
            <p className="text-sm text-destructive px-6">{revokeError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>{tc('cancel')}</AlertDialogCancel>
            <Button onClick={handleRevoke} disabled={revoking}>
              {revoking ? t('revoking') : t('revoke')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────── Expiring Delegations ───────── */

function ExpiringDelegationsTable({
  delegations,
  globalProps,
  globalPropsLoading,
}: {
  delegations: ExpiringVestingDelegation[];
  globalProps: GlobalPropsData | null;
  globalPropsLoading: boolean;
}) {
  const t = useTranslations('wallet');
  const locale = useLocale();

  const [sortField, setSortField] = useState<'expiration' | 'amount'>('expiration');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const copy = [...delegations];
    const dir = sortDir === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      if (sortField === 'expiration') {
        return dir * (new Date(a.expiration).getTime() - new Date(b.expiration).getTime());
      }
      return (
        dir * (parseAssetAmount(a.vesting_shares) - parseAssetAmount(b.vesting_shares))
      );
    });
    return copy;
  }, [delegations, sortField, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (field: 'expiration' | 'amount') => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(1);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  if (delegations.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        {t('noExpiringDelegations')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        {t('delegationCount', { count: delegations.length })}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('expiration')}
                >
                  {t('expirationTime')} <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('amount')}
                >
                  {t('amountReturned')} <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((item) => (
              <TableRow key={`${item.id}`}>
                <TableCell
                  className="cursor-pointer text-muted-foreground"
                  onClick={() => copyToClipboard(item.expiration)}
                  title={item.expiration}
                >
                  {formatTimeAgo(item.expiration, locale)}
                </TableCell>
                <TableCell
                  className="cursor-pointer text-right"
                  onClick={() =>
                    copyToClipboard(
                      globalProps
                        ? `${formatSteemPowerFromVestsString(item.vesting_shares, globalProps)} SP`
                        : item.vesting_shares
                    )
                  }
                  title={formatSpDisplay(item.vesting_shares, globalProps)}
                >
                  {globalPropsLoading ? (
                    <Skeleton className="ml-auto h-4 w-20" />
                  ) : globalProps ? (
                    `${formatSteemPowerFromVestsString(item.vesting_shares, globalProps)} SP`
                  ) : (
                    item.vesting_shares
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Cards */}
      <div className="space-y-2 md:hidden">
        {paged.map((item) => (
          <div
            key={`${item.id}`}
            className="flex items-center justify-between rounded-lg border p-3"
          >
            <div
              className="cursor-pointer text-sm text-muted-foreground"
              onClick={() => copyToClipboard(item.expiration)}
              title={item.expiration}
            >
              {formatTimeAgo(item.expiration, locale)}
            </div>
            <div className="text-right">
              <div
                className="cursor-pointer text-sm font-medium"
                onClick={() =>
                  copyToClipboard(
                    globalProps
                      ? `${formatSteemPowerFromVestsString(item.vesting_shares, globalProps)} SP`
                      : item.vesting_shares
                  )
                }
              >
                {globalPropsLoading
                  ? '...'
                  : globalProps
                    ? `${formatSteemPowerFromVestsString(item.vesting_shares, globalProps)} SP`
                    : item.vesting_shares}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="icon"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
