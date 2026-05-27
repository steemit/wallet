'use client';

import { Suspense, useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useActiveSigningKey, useAuth } from '@/hooks/use-auth';
import { useAccountData } from '@/hooks/use-account-data';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import type { Witness } from '@/lib/steem/types';
import { LoginForm } from '@/components/auth/login-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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
  const { isAuthenticated } = useAuth();
  const username = useSelector((state: RootState) => state.auth.username);
  const signingKey = useActiveSigningKey();
  const [isPending] = useTransition();

  const { data: account, refetch: refetchAccount, loading: isAccountLoading } = useAccountData();

  const [witnesses, setWitnesses] = useState<Witness[]>([]);
  const [customWitness, setCustomWitness] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [loginOpen, setLoginOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    | { type: 'vote'; witnessName: string; approve: boolean }
    | { type: 'proxy'; proxy: string }
    | null
  >(null);

  const [headBlock, setHeadBlock] = useState<number | null>(null);
  const [proxyInput, setProxyInput] = useState('');

  // User's current witness votes
  const userVotes = account?.witness_votes || [];
  const currentProxy = (account as unknown as { proxy?: string })?.proxy || '';

  useEffect(() => {
    const fetchWitnesses = async () => {
      setIsLoading(true);
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
        setIsLoading(false);
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
    if (isAuthenticated && username && signingKey) return true;
    setLoginOpen(true);
    return false;
  }, [isAuthenticated, signingKey, username]);

  const doVote = useCallback(
    async (witnessName: string, approve: boolean) => {
      if (!username || !signingKey) return;
      const signedTx = await SteemSigner.signWitnessVote(username, witnessName, approve, signingKey);
      const response = await apiClient.broadcastWitnessVote(signedTx, username);
      if (!response.success) {
        throw new Error(response.error || (approve ? t('voteError') : t('unvoteError')));
      }
    },
    [signingKey, t, username]
  );

  const handleVote = async (witnessName: string, approve: boolean) => {
    setError('');
    if (!ensureAuthOrOpenDialog()) {
      setPendingAction({ type: 'vote', witnessName, approve });
      return;
    }

    setIsLoading(true);
    try {
      await doVote(witnessName, approve);
      await refetchAccount();
    } catch (err) {
      console.error('Witness vote error:', err);
      setError(err instanceof Error ? err.message : approve ? t('voteError') : t('unvoteError'));
    } finally {
      setIsLoading(false);
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
    if (!username || !signingKey) return;

    setIsLoading(true);
    try {
      const signedTx = await SteemSigner.signWitnessProxy(username, nextProxy, signingKey);
      const resp = await apiClient.broadcastWitnessProxy(signedTx, username);
      if (!resp.success) throw new Error(resp.error || tCommon('error'));
      setProxyInput('');
      await refetchAccount();
    } catch (err) {
      console.error('Witness proxy error:', err);
      setError(err instanceof Error ? err.message : tCommon('error'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!pendingAction || !isAuthenticated || !username || !signingKey) return;
    // Close login dialog after auth is available, but do it async to avoid
    // cascading renders flagged by react-hooks/set-state-in-effect.
    queueMicrotask(() => setLoginOpen(false));

    const run = async () => {
      try {
        setIsLoading(true);
        if (pendingAction.type === 'vote') {
          await doVote(pendingAction.witnessName, pendingAction.approve);
        } else {
          const signedTx = await SteemSigner.signWitnessProxy(username, pendingAction.proxy, signingKey);
          const resp = await apiClient.broadcastWitnessProxy(signedTx, username);
          if (!resp.success) throw new Error(resp.error || tCommon('error'));
        }
        await refetchAccount();
      } catch (err) {
        setError(err instanceof Error ? err.message : tCommon('error'));
      } finally {
        setPendingAction(null);
        setIsLoading(false);
      }
    };

    void run();
  }, [doVote, isAuthenticated, pendingAction, refetchAccount, signingKey, tCommon, username]);

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
    const DISABLED_SIGNING_KEY = 'STM1111111111111111111111111111111114T1Anm';
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
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{tAuth('login')}</DialogTitle>
            </DialogHeader>
            <Suspense fallback={<div className="h-10" />}>
              <LoginForm
                embedded
                {...(username ? { fixedUsername: username } : {})}
                onLoginSuccess={() => setLoginOpen(false)}
              />
            </Suspense>
          </DialogContent>
        </Dialog>
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
                      disabled={isLoading || isPending}
                      className="rounded-l-none"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={handleQuickVote}
                  disabled={isLoading || isPending || !customWitness.trim()}
                  className="sm:w-auto"
                >
                  {isLoading || isPending
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
                disabled={isLoading || isPending}
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
                  disabled={isLoading || isPending}
                />
                <Button type="button" onClick={handleSetProxy} disabled={isLoading || isPending}>
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
              {isLoading ? (
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
                          disabled={isLoading || isPending || disabled}
                        >
                          {t('unvote')}
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleVote(witness.owner, true)}
                          disabled={isLoading || isPending || disabled || !!currentProxy}
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
                    disabled={isLoading || isPending}
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
