'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { WalletBalanceData } from '@/lib/wallet/wallet-balance-types';
import { buildRewardsDisplayStr, hasPendingRewards } from '@/lib/wallet/rewards-display';

export function ClaimRewardsBanner({
  balance,
  isMyAccount,
  loading,
}: {
  balance: WalletBalanceData | null;
  isMyAccount: boolean;
  loading: boolean;
}) {
  const t = useTranslations('wallet');

  if (loading || !isMyAccount || !balance || !hasPendingRewards(balance)) {
    return null;
  }

  return (
    <div className="UserWallet__claimbox">
      <span className="font-bold">
        Your current rewards: {buildRewardsDisplayStr(balance)}
      </span>
      <Button size="sm">
        {t('claimRewards', { defaultMessage: 'Redeem Rewards' })}
      </Button>
    </div>
  );
}
