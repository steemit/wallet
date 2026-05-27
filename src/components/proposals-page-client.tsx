'use client';

import { Suspense, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth, useActiveSigningKey } from '@/hooks/use-auth';
import { useProposals } from '@/hooks/use-proposals';
import { useProposalsMeta } from '@/hooks/use-proposals-meta';
import { LoginForm } from '@/components/auth/login-form';
import { ProposalCreatorDialog } from '@/components/proposals/proposal-creator-dialog';
import { ProposalRemoveDialog } from '@/components/proposals/proposal-remove-dialog';
import { ProposalVotersDialog } from '@/components/proposals/proposal-voters-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
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
import {
  abbreviateNumber,
  filterProposalsBySearch,
  isProposalFunded,
  proposalFundingType,
  proposalLifecycle,
  votesToSp,
} from '@/lib/proposals/utils';
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

function StatusBadge({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex rounded px-1.5 py-0.5 text-xs font-medium capitalize',
        className
      )}
    >
      {children}
    </span>
  );
}

function ProposalRow({
  proposal,
  canVote,
  onVoteToggle,
  voting,
  totalVestingShares,
  totalVestingFundSteem,
  paidProposalIds,
  currentUsername,
  onShowVoters,
  onRemove,
}: {
  proposal: Proposal;
  canVote: boolean;
  voting: boolean;
  onVoteToggle: (proposalId: number, approve: boolean) => void;
  totalVestingShares: string | null;
  totalVestingFundSteem: string | null;
  paidProposalIds: number[];
  currentUsername: string | null;
  onShowVoters: (proposalId: number) => void;
  onRemove: (proposalId: number) => void;
}) {
  const t = useTranslations('wallet.proposalsPage');
  const daily = parseSteemAsset(proposal.daily_pay);
  const durationDays = daysBetween(proposal.start_date, proposal.end_date);
  const totalPay = daily * durationDays;
  const sp =
    totalVestingShares && totalVestingFundSteem
      ? votesToSp(Number(proposal.total_votes ?? 0), totalVestingShares, totalVestingFundSteem)
      : null;

  const lifecycle = proposalLifecycle(proposal.start_date, proposal.end_date);
  const fundingType = proposalFundingType(proposal.receiver);
  const funded = isProposalFunded(
    paidProposalIds,
    proposal.proposal_id,
    proposal.start_date,
    proposal.end_date
  );

  const approveNext = !proposal.upVoted;
  const voteLabel = proposal.upVoted ? t('unvote') : t('vote');
  const isCreator = currentUsername === proposal.creator;

  const lifecycleLabel =
    lifecycle === 'finished'
      ? t('statusFinished')
      : lifecycle === 'started'
        ? t('statusStarted')
        : t('statusNotStarted');

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold leading-snug">
            <a
              href={`https://steemit.com/@${proposal.creator}/${proposal.permlink}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              title={lifecycleLabel}
            >
              {proposal.subject}{' '}
              <span className="text-muted-foreground font-normal">#{proposal.proposal_id}</span>
            </a>
          </CardTitle>
          <div className="flex flex-wrap gap-1">
            <StatusBadge className="bg-muted text-muted-foreground">{lifecycleLabel}</StatusBadge>
            {funded && (
              <StatusBadge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" title={t('fundedTitle')}>
                {t('funded')}
              </StatusBadge>
            )}
            {fundingType === 'burn' && (
              <StatusBadge className="bg-orange-500/15 text-orange-700 dark:text-orange-400" title={t('burnTitle')}>
                {t('burn')}
              </StatusBadge>
            )}
            {fundingType === 'refund' && (
              <StatusBadge className="bg-sky-500/15 text-sky-700 dark:text-sky-400" title={t('refundTitle')}>
                {t('refund')}
              </StatusBadge>
            )}
          </div>
        </div>
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
            <span className="font-medium" title={`${totalPay.toFixed(3)} SBD`}>
              {abbreviateNumber(totalPay)} SBD
            </span>{' '}
            <span className="text-muted-foreground">
              ({t('daily')} {abbreviateNumber(daily)} SBD)
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="min-w-[84px] rounded-md border bg-muted/30 px-3 py-2 text-center text-sm font-semibold hover:bg-muted/50"
            title={sp === null ? t('votesTooltipUnavailable') : `${sp.toFixed(2)} SP`}
            onClick={() => onShowVoters(proposal.proposal_id)}
          >
            {sp === null ? '—' : abbreviateNumber(sp)}
          </button>

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

          {isCreator && (
            <Button type="button" variant="outline" size="sm" onClick={() => onRemove(proposal.proposal_id)}>
              {t('remove')}
            </Button>
          )}
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
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [votersProposalId, setVotersProposalId] = useState<number | null>(null);
  const [removeProposalId, setRemoveProposalId] = useState<number | null>(null);

  const {
    daoTreasury,
    dailyBudget,
    paidProposalIds,
    treasuryFeeSbd,
    loading: metaLoading,
    refreshMeta,
  } = useProposalsMeta();

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

  const filteredProposals = useMemo(
    () => filterProposalsBySearch(proposals, searchTerm),
    [proposals, searchTerm]
  );

  const canVote = isAuthenticated && !!username && !!activeKey;

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
      await Promise.all([refresh(), refreshMeta()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('voteFailed'));
    } finally {
      setVotingId(null);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([refresh(), refreshMeta()]);
  };

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

  const statusTabs: { value: ProposalStatus; label: string }[] = [
    { value: 'votable', label: t('statusVotable') },
    { value: 'active', label: t('statusActive') },
    { value: 'inactive', label: t('statusInactive') },
    { value: 'expired', label: t('statusExpired') },
    { value: 'all', label: t('statusAll') },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pt-6 pb-10 md:px-6">
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
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleRefresh()}
          disabled={loading}
        >
          <RefreshCw className={cn('mr-2 size-4', loading && 'animate-spin')} />
          {t('refresh')}
        </Button>
      </div>

      {(daoTreasury || dailyBudget) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {daoTreasury && (
            <div className="rounded-lg border bg-card px-4 py-3">
              <p className="text-sm text-muted-foreground">{t('daoTreasury')}</p>
              <p className="text-lg font-semibold tabular-nums">
                {metaLoading ? '…' : `${daoTreasury} SBD`}
              </p>
            </div>
          )}
          {dailyBudget && (
            <div className="rounded-lg border bg-card px-4 py-3">
              <p className="text-sm text-muted-foreground">{t('dailyBudget')}</p>
              <p className="text-lg font-semibold tabular-nums">
                {metaLoading ? '…' : `${dailyBudget} SBD`}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={status} onValueChange={(v) => setStatus(v as ProposalStatus)} className="min-w-0">
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            {statusTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="text-xs sm:text-sm">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
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
                onClick={() =>
                  setDirection(direction === 'ascending' ? 'descending' : 'ascending')
                }
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

          <Button
            type="button"
            onClick={() => {
              if (!username || !activeKey) {
                setLoginOpen(true);
                return;
              }
              setCreateOpen(true);
            }}
          >
            {t('create')}
          </Button>
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

      <ProposalCreatorDialog
        key={`${createOpen ? 'open' : 'closed'}:${username ?? 'anon'}`}
        open={createOpen}
        onOpenChange={setCreateOpen}
        username={username}
        treasuryFeeSbd={treasuryFeeSbd}
        onSuccess={() => void handleRefresh()}
        onNeedLogin={() => setLoginOpen(true)}
      />

      <ProposalVotersDialog
        open={votersProposalId !== null}
        onOpenChange={(open) => {
          if (!open) setVotersProposalId(null);
        }}
        proposalId={votersProposalId}
      />

      <ProposalRemoveDialog
        open={removeProposalId !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveProposalId(null);
        }}
        proposalId={removeProposalId ?? 0}
        username={username}
        onSuccess={() => void handleRefresh()}
        onNeedLogin={() => setLoginOpen(true)}
      />

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      {!loading && proposals.length > 0 && (
        <Input
          type="search"
          placeholder={t('searchPlaceholder')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-md"
        />
      )}

      {loading && proposals.length === 0 ? (
        <div className="space-y-3">
          <p className="text-center text-sm text-muted-foreground">{t('loadingSubtitle')}</p>
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : filteredProposals.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('emptyTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{t('emptyBody')}</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {loading && proposals.length > 0 && (
            <p className="text-center text-sm text-muted-foreground">{t('loadingMore')}</p>
          )}
          {filteredProposals.map((p: Proposal) => (
            <ProposalRow
              key={p.proposal_id}
              proposal={p}
              canVote={canVote}
              voting={votingId === p.proposal_id}
              onVoteToggle={onVoteToggle}
              totalVestingShares={globalProps?.total_vesting_shares ?? null}
              totalVestingFundSteem={globalProps?.total_vesting_fund_steem ?? null}
              paidProposalIds={paidProposalIds}
              currentUsername={username}
              onShowVoters={setVotersProposalId}
              onRemove={setRemoveProposalId}
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
