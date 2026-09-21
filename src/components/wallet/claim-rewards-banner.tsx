'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { useAuthRoleKeys } from '@/hooks/use-auth-role-keys';
import type { WalletBalanceData } from '@/lib/wallet/wallet-balance-types';
import { buildRewardsDisplayStr, hasPendingRewards } from '@/lib/wallet/rewards-display';

export function ClaimRewardsBanner({
  username,
  balance,
  isMyAccount,
  loading,
  onClaimed,
}: {
  username: string;
  balance: WalletBalanceData | null;
  isMyAccount: boolean;
  loading: boolean;
  /** Wallet-page success hook: invalidates the browser L1 cache and refetches. */
  onClaimed?: () => void;
}) {
  const t = useTranslations('wallet');
  const { postingKey } = useAuthRoleKeys();

  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  if (loading || !isMyAccount || !balance || claimed || !hasPendingRewards(balance)) {
    return null;
  }

  // Legacy parity (UserWallet.jsx claimRewards mapDispatchToProps + the
  // claimbox button): one click broadcasts claim_reward_balance with the FULL
  // pending amounts of all three token types, exactly as the account reports
  // them (zero-valued strings included — the chain accepts). No confirmation
  // dialog in legacy; the button is disabled while a claim is in flight.
  // Deviation: legacy's click handler only claimed when reward_vesting_steem
  // was non-zero (a liquid-only claimbox button was a silent no-op); here any
  // pending reward the banner shows can be claimed.
  const handleClaim = async () => {
    if (claiming || !username || !postingKey) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const signedTx = await SteemSigner.signClaimRewardBalance(
        username,
        balance.reward_steem_balance,
        balance.reward_sbd_balance,
        balance.reward_vesting_balance,
        postingKey
      );
      const res = await apiClient.broadcastClaimRewardBalance(signedTx, username);
      if (!res.success) {
        setClaimError(res.error || t('claimFailed'));
        setClaiming(false);
        return;
      }
      // Optimistic hide: the wallet page invalidates the browser L1 cache and
      // refetches via onClaimed; if rewards are still pending (e.g. new
      // curation dripped in), the banner re-appears with fresh amounts.
      setClaiming(false);
      setClaimed(true);
      onClaimed?.();
    } catch (err) {
      setClaiming(false);
      setClaimError(err instanceof Error ? err.message : t('claimFailed'));
    }
  };

  return (
    <div className="UserWallet__claimbox">
      <span className="font-bold">
        Your current rewards: {buildRewardsDisplayStr(balance)}
      </span>
      <Button
        size="sm"
        onClick={handleClaim}
        disabled={claiming || !postingKey}
      >
        {claiming ? t('claiming') : t('claimRewards')}
      </Button>
      {!postingKey && <span className="text-muted-foreground text-sm">{t('claimNeedPostingKey')}</span>}
      {claimError && <span className="text-destructive text-sm">{claimError}</span>}
    </div>
  );
}
