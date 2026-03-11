'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { usePrivateKey } from '@/hooks/use-auth';
import { useAccountData } from '@/hooks/use-account-data';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import type { Witness } from '@/lib/steem/types';

export function WitnessVoteForm() {
  const t = useTranslations('wallet');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  const privateKey = usePrivateKey();
  const [isPending, startTransition] = useTransition();

  const { data: account } = useAccountData();

  const [witnesses, setWitnesses] = useState<Witness[]>([]);
  const [filteredWitnesses, setFilteredWitnesses] = useState<Witness[]>([]);
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
        setFilteredWitnesses(response.witnesses as Witness[]);
      } catch (err) {
        console.error('Fetch witnesses error:', err);
        setError('Failed to fetch witnesses');
      } finally {
        setIsLoading(false);
      }
    };

    fetchWitnesses();
  }, []);

  // Filter witnesses based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredWitnesses(witnesses);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = witnesses.filter(
      (w) => w.owner.toLowerCase().includes(query) || w.url?.toLowerCase().includes(query)
    );
    setFilteredWitnesses(filtered);
  }, [searchQuery, witnesses]);

  // Check if user has voted for a witness
  const hasVoted = (witnessName: string): boolean => {
    return userVotes.includes(witnessName);
  };

  const handleVote = async (witness: Witness, approve: boolean) => {
    setError('');
    if (!username || !privateKey) {
      setError('Not authenticated');
      return;
    }

    setIsLoading(true);
    try {
      // Sign transaction
      const signedTx = SteemSigner.signWitnessVote(username, witness.owner, approve, privateKey);

      // Broadcast
      const response = await apiClient.broadcastWitnessVote(signedTx, username);

      if (!response.success) {
        setError(response.error || `Failed to ${approve ? 'vote for' : 'unvote'} witness`);
        setIsLoading(false);
        return;
      }

      // Redirect back to wallet
      startTransition(() => {
        router.push('/wallet');
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
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t('witnessVoting')}
        </h2>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={isLoading || isPending}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {tCommon('back')}
        </button>
      </div>

      {/* Search and Quick Vote */}
      <div className="mb-6 rounded-lg bg-white p-6 shadow dark:bg-gray-800">
        <div className="mb-4">
          <label
            htmlFor="search"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Search Witnesses
          </label>
          <input
            type="text"
            id="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            placeholder="Search by witness name or URL..."
            disabled={isLoading}
          />
        </div>

        {/* Quick Vote Section */}
        <div className="mb-4 rounded-md bg-gray-50 p-4 dark:bg-gray-700">
          <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            Quick Vote
          </p>
          <div className="flex gap-4">
            <select
              value={selectedWitness?.owner || ''}
              onChange={(e) => {
                const witness = witnesses.find((w) => w.owner === e.target.value);
                setSelectedWitness(witness || null);
              }}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
              className="rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              disabled={isLoading}
            >
              <option value="approve">Vote</option>
              <option value="unapprove">Unvote</option>
            </select>
            <button
              type="button"
              onClick={handleQuickVote}
              disabled={isLoading || isPending || !selectedWitness}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {isLoading || isPending ? tCommon('loading') : 'Submit'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Stats */}
        {account && (
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            You have voted for {userVotes.length} witness{userVotes.length !== 1 ? 'es' : ''}
          </div>
        )}
      </div>

      {/* Witnesses List */}
      <div className="rounded-lg bg-white shadow dark:bg-gray-800">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Rank
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Witness
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Votes
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Missed
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Version
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    Loading witnesses...
                  </td>
                </tr>
              ) : filteredWitnesses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No witnesses found
                  </td>
                </tr>
              ) : (
                filteredWitnesses.map((witness) => (
                  <tr
                    key={witness.id}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${
                      hasVoted(witness.owner)
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-900 dark:text-white">
                      #{witness.position}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {witness.owner}
                            {hasVoted(witness.owner) && (
                              <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                                ✓ Voted
                              </span>
                            )}
                          </div>
                          {witness.url && (
                            <a
                              href={witness.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {witness.url.replace(/^https?:\/\//, '').substring(0, 30)}
                              {witness.url.length > 30 ? '...' : ''}
                            </a>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-900 dark:text-white">
                      {formatVotes(witness.votes)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-900 dark:text-white">
                      <span
                        className={
                          witness.total_missed > 100
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-gray-900 dark:text-white'
                        }
                      >
                        {witness.total_missed}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {witness.running_version}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-right text-sm">
                      {hasVoted(witness.owner) ? (
                        <button
                          type="button"
                          onClick={() => handleVote(witness, false)}
                          disabled={isLoading || isPending}
                          className="rounded-md border border-red-300 px-3 py-1 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          Unvote
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleVote(witness, true)}
                          disabled={isLoading || isPending}
                          className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
                        >
                          Vote
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
