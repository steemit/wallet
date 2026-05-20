'use client';

import { useMemo, useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useActiveSigningKey } from '@/hooks/use-auth';
import { useAccountData } from '@/hooks/use-account-data';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import type { Witness } from '@/lib/steem/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { transfersPathForUsername } from '@/lib/wallet/wallet-modal-search-params';

export function WitnessVoteForm() {
  const t = useTranslations('wallet');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  const signingKey = useActiveSigningKey();
  const [isPending, startTransition] = useTransition();

  const { data: account } = useAccountData();

  const [witnesses, setWitnesses] = useState<Witness[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedWitness, setSelectedWitness] = useState<Witness | null>(null);
  const [action, setAction] = useState<'approve' | 'unapprove'>('approve');

  // User's current witness votes
  const userVotes = account?.witness_votes || [];

  useEffect(() => {
    const fetchWitnesses = async () => {
      setIsLoading(true);
      try {
        const response = await apiClient.getWitnesses(100);
        if (response.error) {
          setError(response.error);
          return;
        }
        setWitnesses(response.witnesses as Witness[]);
      } catch (err) {
        console.error('Fetch witnesses error:', err);
        setError('Failed to fetch witnesses');
      } finally {
        setIsLoading(false);
      }
    };

    fetchWitnesses();
  }, []);

  const filteredWitnesses = useMemo(() => {
    if (!searchQuery.trim()) return witnesses;

    const query = searchQuery.toLowerCase();
    return witnesses.filter(
      (w) => w.owner.toLowerCase().includes(query) || w.url?.toLowerCase().includes(query)
    );
  }, [searchQuery, witnesses]);

  // Check if user has voted for a witness
  const hasVoted = (witnessName: string): boolean => {
    return userVotes.includes(witnessName);
  };

  const handleVote = async (witness: Witness, approve: boolean) => {
    setError('');
    if (!username || !signingKey) {
      setError('Not authenticated');
      return;
    }

    setIsLoading(true);
    try {
      // Sign transaction
      const signedTx = await SteemSigner.signWitnessVote(username, witness.owner, approve, signingKey);

      // Broadcast
      const response = await apiClient.broadcastWitnessVote(signedTx, username);

      if (!response.success) {
        setError(response.error || `Failed to ${approve ? 'vote for' : 'unvote'} witness`);
        setIsLoading(false);
        return;
      }

      // Redirect back to user's wallet
      startTransition(() => {
        router.push(transfersPathForUsername(username));
      });
    } catch (err) {
      console.error('Witness vote error:', err);
      setError(`Failed to ${approve ? 'vote for' : 'unvote'} witness`);
      setIsLoading(false);
    }
  };

  const handleQuickVote = async () => {
    if (!selectedWitness) {
      setError('Please select a witness');
      return;
    }

    const approve = action === 'approve';
    await handleVote(selectedWitness, approve);
  };

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

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-6 md:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-foreground">
          {t('witnessVoting')}
        </h2>
        <Button
          variant="outline"
          onClick={() => router.back()}
          disabled={isLoading || isPending}
        >
          {tCommon('back')}
        </Button>
      </div>

      {/* Search and Quick Vote */}
      <Card className="mb-6 shadow-sm">
        <CardContent className="pt-6">
          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="search" className="text-base">Search Witnesses</Label>
            <Input
              type="text"
              id="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by witness name or URL..."
              disabled={isLoading}
            />
          </div>

          {/* Quick Vote Section */}
          <div className="mb-4 rounded-md bg-muted p-4 border border-border">
            <p className="mb-2 text-base font-medium text-foreground">
              Quick Vote
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <select
                value={selectedWitness?.owner || ''}
                onChange={(e) => {
                  const witness = witnesses.find((w) => w.owner === e.target.value);
                  setSelectedWitness(witness || null);
                }}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={isLoading}
              >
                <option value="">Select a witness...</option>
                {witnesses.slice(0, 50).map((w) => (
                  <option key={w.id} value={w.owner}>
                    #{w.position} {w.owner} ({formatVotes(w.votes)} votes)
                    {hasVoted(w.owner) ? ' ✓' : ''}
                  </option>
                ))}
              </select>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as 'approve' | 'unapprove')}
                className="w-32 rounded-md border border-input bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={isLoading}
              >
                <option value="approve">Vote</option>
                <option value="unapprove">Unvote</option>
              </select>
              <Button
                type="button"
                onClick={handleQuickVote}
                disabled={isLoading || isPending || !selectedWitness}
                className="w-32"
              >
                {isLoading || isPending ? tCommon('loading') : 'Submit'}
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 mb-4">
              <p className="text-sm text-destructive font-medium">{error}</p>
            </div>
          )}

          {/* Stats */}
          {account && (
            <div className="text-base text-muted-foreground">
              You have voted for {userVotes.length} witness{userVotes.length !== 1 ? 'es' : ''}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Witnesses List */}
      <Card className="shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Witness</TableHead>
                <TableHead>Votes</TableHead>
                <TableHead>Missed</TableHead>
                <TableHead>Version</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Loading witnesses...
                  </TableCell>
                </TableRow>
              ) : filteredWitnesses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No witnesses found
                  </TableCell>
                </TableRow>
              ) : (
                filteredWitnesses.map((witness) => (
                  <TableRow
                    key={witness.id}
                    className={hasVoted(witness.owner) ? 'bg-primary/5 hover:bg-primary/10' : ''}
                  >
                    <TableCell className="font-medium">
                      #{witness.position}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <div className="font-medium text-foreground flex items-center gap-2">
                          {witness.owner}
                          {hasVoted(witness.owner) && (
                            <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">
                              ✓ Voted
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
                      {hasVoted(witness.owner) ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleVote(witness, false)}
                          disabled={isLoading || isPending}
                        >
                          Unvote
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleVote(witness, true)}
                          disabled={isLoading || isPending}
                        >
                          Vote
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
