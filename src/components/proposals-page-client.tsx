'use client';

import { Suspense, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth, useActiveSigningKey } from '@/hooks/use-auth';
import { useProposals } from '@/hooks/use-proposals';
import { LoginForm } from '@/components/auth/login-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { apiClient, SteemSigner } from '@/lib/steem/client';
import type { Proposal, ProposalOrderBy, ProposalStatus } from '@/lib/steem/types';
import { parseSteemAsset } from '@/lib/steem/parse-asset';
import { ArrowUpCircle, ArrowDownAZ, ArrowUpAZ, RefreshCw } from 'lucide-react';

function formatDate(iso: string) {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso.endsWith('Z') ? startIso : `${startIso}Z`).getTime();
  const end = new Date(endIso.endsWith('Z') ? endIso : `${endIso}Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

function votesToSp(totalVotes: number, totalVestingShares: string, totalVestingFundSteem: string) {
  const totalVests = parseSteemAsset(totalVestingShares);
  const totalFund = parseSteemAsset(totalVestingFundSteem);
  if (totalVests <= 0 || totalFund <= 0) return 0;
  return totalFund * (totalVotes / totalVests) * 0.000001;
}

function ProposalRow({
  proposal,
  canVote,
  onVoteToggle,
  voting,
  totalVestingShares,
  totalVestingFundSteem,
}: {
  proposal: Proposal;
  canVote: boolean;
  voting: boolean;
  onVoteToggle: (proposalId: number, approve: boolean) => void;
  totalVestingShares: string | null;
  totalVestingFundSteem: string | null;
}) {
  const t = useTranslations('wallet.proposalsPage');
  const daily = parseSteemAsset(proposal.daily_pay);
  const durationDays = daysBetween(proposal.start_date, proposal.end_date);
  const totalPay = daily * durationDays;
  const sp =
    totalVestingShares && totalVestingFundSteem
      ? votesToSp(Number(proposal.total_votes ?? 0), totalVestingShares, totalVestingFundSteem)
      : null;

  const approveNext = !proposal.upVoted;
  const voteLabel = proposal.upVoted ? t('unvote') : t('vote');

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base font-semibold leading-snug">
          <a
            href={`https://steemit.com/@${proposal.creator}/${proposal.permlink}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {proposal.subject}{' '}
            <span className="text-muted-foreground font-normal">#{proposal.proposal_id}</span>
          </a>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {formatDate(proposal.start_date)} – {formatDate(proposal.end_date)} ·{' '}
          {t('days', { count: durationDays })}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <div className="text-muted-foreground">
            {t('by')}{' '}
            <Link className="text-foreground hover:underline" href={`/@${proposal.creator}`}>
              @{proposal.creator}
            </Link>
            {proposal.creator !== proposal.receiver && (
              <>
                {' '}
                {t('for')}{' '}
                <Link className="text-foreground hover:underline" href={`/@${proposal.receiver}`}>
                  @{proposal.receiver}
                </Link>
              </>
            )}
          </div>
          <div className="mt-1">
            <span className="font-medium">{totalPay.toFixed(3)} SBD</span>{' '}
            <span className="text-muted-foreground">
              ({t('daily')} {daily.toFixed(3)} SBD)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="min-w-[84px] rounded-md border bg-muted/30 px-3 py-2 text-center text-sm font-semibold"
            title={sp === null ? t('votesTooltipUnavailable') : `${sp.toFixed(2)} SP`}
          >
            {sp === null ? '—' : `${sp.toFixed(2)} SP`}
          </div>

          <Button
            type="button"
            variant={proposal.upVoted ? 'secondary' : 'default'}
            disabled={!canVote || voting}
            onClick={() => onVoteToggle(proposal.proposal_id, approveNext)}
            className={cn(!canVote && 'cursor-not-allowed')}
          >
            <ArrowUpCircle className="mr-2 size-4" />
            {voteLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProposalsPageClient() {
  const t = useTranslations('wallet.proposalsPage');
  const tAuth = useTranslations('auth');
  const { username, isAuthenticated } = useAuth();
  const activeKey = useActiveSigningKey();
  const [loginOpen, setLoginOpen] = useState(false);
  const [votingId, setVotingId] = useState<number | null>(null);

  const {
    proposals,
    loading,
    error,
    globalProps,
    status,
    order,
    direction,
    setStatus,
    setOrder,
    setDirection,
    loadMore,
    refresh,
    limit,
  } = useProposals(username);

  const canVote = isAuthenticated && !!username && !!activeKey;

  const orderLabel = useMemo(() => {
    const labels: Record<ProposalOrderBy, string> = {
      by_total_votes: t('sortTotalVotes'),
      by_creator: t('sortCreator'),
      by_start_date: t('sortStartDate'),
      by_end_date: t('sortEndDate'),
    };
    return labels[order];
  }, [order, t]);

  const directionLabel = direction === 'ascending' ? t('ascending') : t('descending');

  const onVoteToggle = async (proposalId: number, approve: boolean) => {
    if (!username || !activeKey) {
      toast.error(t('signInToVote'));
      setLoginOpen(true);
      return;
    }

    setVotingId(proposalId);
    try {
      const signedTx = await SteemSigner.signUpdateProposalVotes(
        username,
        [proposalId],
        approve,
        activeKey
      );
      const res = await apiClient.broadcastProposalVote(signedTx, username);
      if (!res.success) {
        toast.error(res.error ?? res.details ?? t('voteFailed'));
        return;
      }
      toast.success(approve ? t('voteSuccess') : t('unvoteSuccess'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('voteFailed'));
    } finally {
      setVotingId(null);
    }
  };

  const statusTabs: { value: ProposalStatus; label: string }[] = [
    { value: 'votable', label: t('statusVotable') },
    { value: 'active', label: t('statusActive') },
    { value: 'expired', label: t('statusExpired') },
    { value: 'all', label: t('statusAll') },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pt-6 pb-10 md:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={cn('mr-2 size-4', loading && 'animate-spin')} />
            {t('refresh')}
          </Button>
        </div>
      </div>

      {!canVote && (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {t('signInToVote')}{' '}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setLoginOpen(true)}
          >
            {tAuth('login')}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={status} onValueChange={(v) => setStatus(v as ProposalStatus)}>
          <TabsList>
            {statusTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline">
                <ArrowDownAZ className="mr-2 size-4" />
                {t('sort')}: {orderLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {(
                [
                  ['by_total_votes', t('sortTotalVotes')],
                  ['by_creator', t('sortCreator')],
                  ['by_start_date', t('sortStartDate')],
                  ['by_end_date', t('sortEndDate')],
                ] as const
              ).map(([value, label]) => (
                <DropdownMenuItem key={value} onClick={() => setOrder(value)}>
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDirection(direction === 'ascending' ? 'descending' : 'ascending')}
              >
                {direction === 'ascending' ? (
                  <ArrowDownAZ className="mr-2 size-4" />
                ) : (
                  <ArrowUpAZ className="mr-2 size-4" />
                )}
                {t('direction')}: {directionLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tAuth('login')}</DialogTitle>
            <DialogDescription className="sr-only">{tAuth('login')}</DialogDescription>
          </DialogHeader>
          <Suspense
            fallback={
              <div className="space-y-4 py-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            }
          >
            <LoginForm embedded onLoginSuccess={() => setLoginOpen(false)} />
          </Suspense>
        </DialogContent>
      </Dialog>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      {loading && proposals.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : proposals.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('emptyTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{t('emptyBody')}</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {proposals.map((p: Proposal) => (
            <ProposalRow
              key={p.proposal_id}
              proposal={p}
              canVote={canVote}
              voting={votingId === p.proposal_id}
              onVoteToggle={onVoteToggle}
              totalVestingShares={globalProps?.total_vesting_shares ?? null}
              totalVestingFundSteem={globalProps?.total_vesting_fund_steem ?? null}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-center pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={loadMore}
          disabled={loading || proposals.length < limit}
        >
          {loading ? t('loadingMore') : t('loadMore')}
        </Button>
      </div>
    </div>
  );
}

