'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useAuth } from '@/hooks/use-auth';
import { useSessionSigning } from '@/hooks/use-session-signing';
import { useAccountData } from '@/hooks/use-account-data';
import { apiClient } from '@/lib/steem/client';
import type { Operation, Witness } from '@/lib/steem/types';
import { LoginForm } from '@/components/auth/login-form';
import { DISABLED_SIGNING_KEY } from '@/lib/steem/constants';
import { toast } from 'sonner';
import { userActionRecord } from '@/lib/analytics/overseer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function compareWitnessByVotes(a: Witness, b: Witness): number {
  try {
    const av = BigInt(a.votes ?? '0');
    const bv = BigInt(b.votes ?? '0');
    if (av > bv) return -1;
    if (av < bv) return 1;
    return a.owner.localeCompare(b.owner);
  } catch {
    return 0;
  }
}

function formatWitnessRank(rank: number): string {
  return rank < 10 ? `0${rank}` : String(rank);
}

export function WitnessVoteForm() {
  const t = useTranslations('witnesses');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');
  const tWallet = useTranslations('wallet');
  const { isAuthenticated } = useAuth();
  const username = useSelector((state: RootState) => state.auth.username);
  // Unified signing entry (A6-T4): privateKey sessions sign through the
  // facade's legacy backend exactly as before (active key, owner fallback);
  // vault identity sessions get the per-key password dialog. The pre-A6
  // signingKey gate (and the vaultUnsupported notice its login dialog could
  // reach) is retired — an authenticated vault session signs through the
  // per-key password path instead of re-opening a login dialog.
  const signing = useSessionSigning();
  const [isPending] = useTransition();

  const { data: account, refetch: refetchAccount, loading: isAccountLoading } = useAccountData();

  const [witnesses, setWitnesses] = useState<Witness[]>([]);
  const [customWitness, setCustomWitness] = useState('');
  const [error, setError] = useState('');
  const [witnessesLoading, setWitnessesLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [loginOpen, setLoginOpen] = useState(false);
  /** Classic re-auth for a privateKey session that lacks an active/owner key. */
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    | { type: 'vote'; witnessName: string; approve: boolean }
    | { type: 'proxy'; proxy: string }
    | null
  >(null);

  const [headBlock, setHeadBlock] = useState<number | null>(null);
  const [proxyInput, setProxyInput] = useState('');

  // User's current witness votes
  const [localVotes, setLocalVotes] = useState<string[]>([]);
  const userVotes = localVotes;
  const currentProxy = account?.proxy || '';
  const lastOptimisticUpdateRef = useRef<{ at: number; expected: Set<string> } | null>(null);

  useEffect(() => {
    const serverVotes = account?.witness_votes ?? [];

    // Protect against brief server-side / caching lag that can momentarily return
    // stale witness votes right after a successful broadcast (causes button flicker).
    const optimistic = lastOptimisticUpdateRef.current;
    if (optimistic && Date.now() - optimistic.at < 10_000) {
      const serverSet = new Set(serverVotes);
      let includesAllExpected = true;
      for (const v of optimistic.expected) {
        if (!serverSet.has(v)) {
          includesAllExpected = false;
          break;
        }
      }
      if (!includesAllExpected) return;
      lastOptimisticUpdateRef.current = null;
    }

    // Keep local optimistic votes in sync with server state, but do it async
    // to avoid react-hooks/set-state-in-effect lint errors.
    queueMicrotask(() => setLocalVotes(serverVotes));
  }, [account?.witness_votes]);

  useEffect(() => {
    const fetchWitnesses = async () => {
      setWitnessesLoading(true);
      try {
        const [witnessesResp, propsResp] = await Promise.all([
          apiClient.getWitnesses(100),
          apiClient.getGlobalProps(),
        ]);
        if (witnessesResp.error) {
          setError(witnessesResp.error);
          return;
        }
        setWitnesses((witnessesResp.witnesses ?? []) as Witness[]);
        if (propsResp?.props?.head_block_number) {
          setHeadBlock(propsResp.props.head_block_number);
        }
      } catch (err) {
        console.error('Fetch witnesses error:', err);
        setError(tCommon('error'));
      } finally {
        setWitnessesLoading(false);
      }
    };

    fetchWitnesses();
  }, [tCommon]);

  const sortedWitnesses = useMemo(
    () => [...witnesses].sort(compareWitnessByVotes),
    [witnesses]
  );

  const topWitnessOwners = useMemo(
    () => new Set(sortedWitnesses.map((w) => w.owner)),
    [sortedWitnesses]
  );

  const additionalWitnessVotes = useMemo(() => {
    if (currentProxy) return [];
    return userVotes.filter((name) => !topWitnessOwners.has(name));
  }, [currentProxy, topWitnessOwners, userVotes]);

  const hasVoted = (witnessName: string): boolean => userVotes.includes(witnessName);

  const ensureAuthOrOpenDialog = useCallback((): boolean => {
    // Key availability is the unified signing entry's business now: a vault
    // session (no Redux keys) signs through the per-key password path, a
    // privateKey session without an active/owner key gets the classic re-auth
    // dialog from the `needsClassicReauth` outcome.
    if (isAuthenticated && username) return true;
    setLoginOpen(true);
    return false;
  }, [isAuthenticated, username]);

  /**
   * Sign + broadcast one witness vote through the unified entry.
   * Resolves `true` when the vote was signed, broadcast and recorded;
   * `false` when the flow aborted (vault dialog cancelled, classic re-auth
   * opened, or no session) — callers must skip their success side effects.
   * Throws on signing/broadcast failure for the existing error surfaces.
   */
  const doVote = useCallback(
    async (witnessName: string, approve: boolean): Promise<boolean> => {
      if (!username) return false;
      // The exact operation tuple SteemSigner.signWitnessVote built
      // internally. account_witness_vote is an active-class operation.
      const operations: Operation[] = [
        ['account_witness_vote', { account: username, witness: witnessName, approve }],
      ];
      const outcome = await signing.sign({
        operations,
        accountName: username,
        role: 'active',
      });
      if (outcome.status === 'cancelled') return false;
      if (outcome.status === 'needsClassicReauth') {
        setReauthOpen(true);
        return false;
      }
      if (outcome.status === 'error') {
        throw new Error(approve ? t('voteError') : t('unvoteError'));
      }
      const response = await apiClient.broadcastWitnessVote(outcome.result.signedTx, username);
      if (!response.success) {
        throw new Error(
          response.error || (approve ? t('voteError') : t('unvoteError'))
        );
      }
      userActionRecord('account_witness_vote', { username, witness: witnessName });
      return true;
    },
    [t, username, signing]
  );

  /**
   * Sign + broadcast one witness proxy change — same abort contract as doVote.
   */
  const doSetProxy = useCallback(
    async (nextProxy: string): Promise<boolean> => {
      if (!username) return false;
      // The exact operation tuple SteemSigner.signWitnessProxy built
      // internally. account_witness_proxy is an active-class operation.
      const operations: Operation[] = [
        ['account_witness_proxy', { account: username, proxy: nextProxy }],
      ];
      const outcome = await signing.sign({
        operations,
        accountName: username,
        role: 'active',
      });
      if (outcome.status === 'cancelled') return false;
      if (outcome.status === 'needsClassicReauth') {
        setReauthOpen(true);
        return false;
      }
      if (outcome.status === 'error') {
        throw new Error(tCommon('error'));
      }
      const resp = await apiClient.broadcastWitnessProxy(outcome.result.signedTx, username);
      if (!resp.success) throw new Error(resp.error || tCommon('error'));
      userActionRecord('account_witness_proxy', { username, proxy: nextProxy });
      return true;
    },
    [tCommon, username, signing]
  );

  const handleVote = async (witnessName: string, approve: boolean) => {
    setError('');
    if (!ensureAuthOrOpenDialog()) {
      setPendingAction({ type: 'vote', witnessName, approve });
      return;
    }

    setActionLoading(true);
    try {
      const done = await doVote(witnessName, approve);
      if (!done) return;
      setLocalVotes((prev) => {
        const set = new Set(prev);
        if (approve) set.add(witnessName);
        else set.delete(witnessName);
        lastOptimisticUpdateRef.current = { at: Date.now(), expected: set };
        return [...set];
      });
      toast.success(approve ? t('voteSuccess') : t('unvoteSuccess'));
      await refetchAccount();
    } catch (err) {
      console.error('Witness vote error:', err);
      setError(err instanceof Error ? err.message : approve ? t('voteError') : t('unvoteError'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleQuickVote = async () => {
    const witnessName = customWitness.trim().replace(/^@/, '').toLowerCase();
    if (!witnessName) {
      setError(t('voteOutsideTopEmpty'));
      return;
    }

    const approve = !hasVoted(witnessName);
    await handleVote(witnessName, approve);
  };

  const handleSetProxy = async () => {
    const nextProxy = proxyInput.trim().replace(/^@/, '');
    setError('');
    if (!ensureAuthOrOpenDialog()) {
      setPendingAction({ type: 'proxy', proxy: nextProxy });
      return;
    }

    setActionLoading(true);
    try {
      const done = await doSetProxy(nextProxy);
      if (!done) return;
      setProxyInput('');
      toast.success(nextProxy ? t('proxySetSuccess') : t('proxyClearedSuccess'));
      await refetchAccount();
    } catch (err) {
      console.error('Witness proxy error:', err);
      setError(err instanceof Error ? err.message : tCommon('error'));
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    if (!pendingAction || !isAuthenticated || !username) return;
    // Close login dialog after auth is available, but do it async to avoid
    // cascading renders flagged by react-hooks/set-state-in-effect.
    queueMicrotask(() => setLoginOpen(false));

    const run = async () => {
      try {
        setActionLoading(true);
        if (pendingAction.type === 'vote') {
          const done = await doVote(pendingAction.witnessName, pendingAction.approve);
          if (!done) return;
          setLocalVotes((prev) => {
            const set = new Set(prev);
            if (pendingAction.approve) set.add(pendingAction.witnessName);
            else set.delete(pendingAction.witnessName);
            lastOptimisticUpdateRef.current = { at: Date.now(), expected: set };
            return [...set];
          });
          toast.success(pendingAction.approve ? t('voteSuccess') : t('unvoteSuccess'));
        } else {
          const done = await doSetProxy(pendingAction.proxy);
          if (!done) return;
          toast.success(pendingAction.proxy ? t('proxySetSuccess') : t('proxyClearedSuccess'));
        }
        await refetchAccount();
      } catch (err) {
        setError(err instanceof Error ? err.message : tCommon('error'));
      } finally {
        setPendingAction(null);
        setActionLoading(false);
      }
    };

    void run();
  }, [doVote, doSetProxy, isAuthenticated, pendingAction, refetchAccount, t, tCommon, username]);

  // Format vote count for display
  const formatVotes = (votes: string): string => {
    const voteValue = BigInt(votes);
    const sp = Number(voteValue) / 1_000_000_000_000; // Convert to SP (simplified)
    if (sp >= 1_000_000) {
      return `${(sp / 1_000_000).toFixed(1)}M`;
    }
    if (sp >= 1_000) {
      return `${(sp / 1_000).toFixed(1)}K`;
    }
    return sp.toFixed(2);
  };

  const isWitnessDisabled = (w: Witness): { disabled: boolean; reason?: string } => {
    if (w.signing_key === DISABLED_SIGNING_KEY) return { disabled: true, reason: 'disabled key' };
    if (headBlock !== null && typeof w.last_confirmed_block_num === 'number') {
      const secs = (headBlock - w.last_confirmed_block_num) * 3;
      if (secs > 604800) return { disabled: true, reason: 'stale blocks' };
    }
    return { disabled: false };
  };

  const voteRemaining = Math.max(0, 30 - userVotes.length);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-6 md:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-foreground">
          {t('witnessVoting')}
        </h2>
        <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
          <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{tAuth('login')}</DialogTitle>
              <DialogDescription className="sr-only">{tAuth('login')}</DialogDescription>
            </DialogHeader>
            <Suspense fallback={<div className="h-10" />}>
              {/* Unauthenticated visitors may log in as any account; the
                  active-authority requirement keeps a privateKey login fit
                  for witness voting the first time (both witness ops are
                  active-class). No fixedUsername: the dialog only opens for
                  visitors without a session — this retires the pre-A6
                  conditional pin that could surface the Vault Mode
                  "unsupported" notice; in Vault Mode this dialog offers
                  identity selection and the per-action password dialog
                  enforces the floor after login. */}
              <LoginForm
                embedded
                requiredAuthTypes={['active']}
                onLoginSuccess={() => setLoginOpen(false)}
              />
            </Suspense>
          </DialogContent>
        </Dialog>

        <Dialog open={reauthOpen} onOpenChange={setReauthOpen}>
          <DialogContent className="z-[60] max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{tWallet('reauthTitle')}</DialogTitle>
              <DialogDescription>{tWallet('reauthDescription')}</DialogDescription>
            </DialogHeader>
            <Suspense fallback={<div className="h-10" />}>
              <LoginForm
                embedded
                fixedUsername={username ?? ''}
                requiredAuthTypes={['active']}
                onLoginSuccess={() => setReauthOpen(false)}
              />
            </Suspense>
          </DialogContent>
        </Dialog>

        {signing.dialog}
      </div>

      {/* Vote stats + quick vote (outside top 100) */}
      {!currentProxy && (
        <Card className="mb-6 shadow-sm">
          <CardContent className="pt-6 space-y-4">
            {account && !isAccountLoading && (
              <div className="text-base text-muted-foreground">
                {t('youHaveVoted', { count: userVotes.length })}{' '}
                <span className="text-foreground/80">
                  ({t('votesRemaining', { count: voteRemaining })})
                </span>
              </div>
            )}

            <div>
              <p className="mb-3 text-sm text-muted-foreground">{t('voteOutsideTopHint')}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex flex-1 flex-col gap-2">
                  <Label htmlFor="custom-witness" className="sr-only">
                    {t('witness')}
                  </Label>
                  <div className="flex">
                    <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                      @
                    </span>
                    <Input
                      id="custom-witness"
                      type="text"
                      value={customWitness}
                      onChange={(e) => setCustomWitness(e.target.value)}
                      placeholder={t('voteOutsideTopPlaceholder')}
                      disabled={actionLoading || isPending}
                      className="rounded-l-none"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={handleQuickVote}
                  disabled={actionLoading || isPending || !customWitness.trim()}
                  className="sm:w-auto"
                >
                  {actionLoading || isPending
                    ? tCommon('loading')
                    : hasVoted(customWitness.trim().replace(/^@/, '').toLowerCase())
                      ? t('unvote')
                      : t('vote')}
                </Button>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
                <p className="text-sm text-destructive font-medium">{error}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Witness proxy */}
      <Card className="mb-6 shadow-sm">
        <CardContent className="pt-6">
          {currentProxy ? (
            <div className="flex flex-col gap-3">
              <div className="text-sm text-muted-foreground">
                {t('proxySetTo', { proxy: `@${currentProxy}` })}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setProxyInput('');
                  void handleSetProxy();
                }}
                disabled={actionLoading || isPending}
              >
                {t('proxyClear')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="proxy" className="text-base">{t('proxyTitle')}</Label>
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  id="proxy"
                  value={proxyInput}
                  onChange={(e) => setProxyInput(e.target.value)}
                  placeholder={t('proxyPlaceholder')}
                  disabled={actionLoading || isPending}
                />
                <Button type="button" onClick={handleSetProxy} disabled={actionLoading || isPending}>
                  {t('proxySet')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {error && currentProxy && (
        <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 p-4">
          <p className="text-sm text-destructive font-medium">{error}</p>
        </div>
      )}

      {/* Witnesses List */}
      {!currentProxy && (
      <Card className="shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('rank')}</TableHead>
                <TableHead>{t('witness')}</TableHead>
                <TableHead>{t('votes')}</TableHead>
                <TableHead>{t('missed')}</TableHead>
                <TableHead>{t('version')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {witnessesLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    {t('loadingWitnesses')}
                  </TableCell>
                </TableRow>
              ) : sortedWitnesses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    {t('noWitnessesFound')}
                  </TableCell>
                </TableRow>
              ) : (
                sortedWitnesses.map((witness, index) => {
                    const { disabled } = isWitnessDisabled(witness);
                    const voted = hasVoted(witness.owner);
                    return (
                  <TableRow
                    key={witness.owner}
                    className={voted ? 'bg-primary/5 hover:bg-primary/10' : ''}
                  >
                    <TableCell className="font-medium tabular-nums">
                      {formatWitnessRank(index + 1)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <div className="font-medium text-foreground flex items-center gap-2">
                          <span className={disabled ? 'line-through text-muted-foreground' : ''}>
                            {witness.owner}
                          </span>
                          {voted && (
                            <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">
                              ✓ {t('voted')}
                            </span>
                          )}
                        </div>
                        {witness.url && (
                          <a
                            href={witness.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 text-xs text-accent-foreground hover:underline"
                          >
                            {witness.url.replace(/^https?:\/\//, '').substring(0, 30)}
                            {witness.url.length > 30 ? '...' : ''}
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatVotes(witness.votes)}</TableCell>
                    <TableCell>
                      <span className={witness.total_missed > 100 ? 'text-destructive font-medium' : ''}>
                        {witness.total_missed}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {witness.running_version}
                    </TableCell>
                    <TableCell className="text-right">
                      {voted ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleVote(witness.owner, false)}
                          disabled={actionLoading || isPending || disabled}
                        >
                          {t('unvote')}
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleVote(witness.owner, true)}
                          disabled={actionLoading || isPending || disabled || !!currentProxy}
                        >
                          {t('vote')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                    );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
      )}

      {!currentProxy && additionalWitnessVotes.length > 0 && (
        <Card className="shadow-sm">
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm text-muted-foreground">{t('additionalVotesHint')}</p>
            <ul className="space-y-2">
              {additionalWitnessVotes.map((name) => (
                <li key={name} className="flex items-center justify-between gap-3">
                  <span className="font-medium">@{name}</span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => handleVote(name, false)}
                    disabled={actionLoading || isPending}
                  >
                    {t('unvote')}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
