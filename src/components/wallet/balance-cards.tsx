'use client';

import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { apiClient } from '@/lib/steem/client';
import { useTranslations } from 'next-intl';
import type { SteemAccount } from '@/lib/steem/types';

interface BalanceData {
  balance: string;
  sbd_balance: string;
  vesting_shares: string;
  delegated_vesting_shares: string;
  received_vesting_shares: string;
  vesting_withdraw_rate: string;
}

export function BalanceCards() {
  const t = useTranslations('wallet');
  const username = useSelector((state: RootState) => state.auth.username);

  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!username) return;

    const fetchBalance = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await apiClient.getAccounts([username]);

        if (response.error || !response.accounts || response.accounts.length === 0) {
          setError(response.error || 'Failed to fetch balance');
          return;
        }

        const account = response.accounts[0] as SteemAccount;
        setBalance({
          balance: account.balance,
          sbd_balance: account.sbd_balance,
          vesting_shares: account.vesting_shares,
          delegated_vesting_shares: account.delegated_vesting_shares,
          received_vesting_shares: account.received_vesting_shares,
          vesting_withdraw_rate: account.vesting_withdraw_rate,
        });
      } catch (err) {
        console.error('Error fetching balance:', err);
        setError('Failed to fetch balance');
      } finally {
        setLoading(false);
      }
    };

    fetchBalance();
  }, [username]);

  const formatBalance = (value: string) => {
    const match = value.match(/([\d.]+)\s+(STEEM|SBD|VESTS)/);
    if (!match || !match[1] || !match[2]) return value;
    return `${parseFloat(match[1]).toFixed(3)} ${match[2]}`;
  };

  const formatVests = (value: string) => {
    const match = value.match(/([\d.]+)\s+VESTS/);
    if (!match || !match[1]) return '0 VESTS';
    const vests = parseFloat(match[1]);
    // Roughly convert VESTS to SP (1 SP ≈ 2000 VESTS)
    const sp = vests / 2000;
    return `${sp.toFixed(2)} SP (${vests.toFixed(0)} VESTS)`;
  };

  const cards = [
    {
      title: t('steemBalance'),
      value: balance ? formatBalance(balance.balance) : '--',
      color: 'blue',
      icon: '💰',
    },
    {
      title: t('sbdBalance'),
      value: balance ? formatBalance(balance.sbd_balance) : '--',
      color: 'green',
      icon: '💵',
    },
    {
      title: t('vestingShares'),
      value: balance ? formatVests(balance.vesting_shares) : '--',
      color: 'purple',
      icon: '📊',
    },
  ];

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.title}
          className="rounded-lg bg-white p-6 shadow dark:bg-gray-800"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {card.title}
            </h3>
            <span className="text-2xl">{card.icon}</span>
          </div>
          <p
            className={`mt-4 text-2xl font-bold ${
              card.color === 'blue'
                ? 'text-blue-600 dark:text-blue-400'
                : card.color === 'green'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-purple-600 dark:text-purple-400'
            }`}
          >
            {loading ? '...' : error ? 'Error' : card.value}
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
