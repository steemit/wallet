'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { useAuthRoleKeys } from '@/hooks/use-auth-role-keys';
import {
  REMEMBERED_POSTING_KEY_KEY,
  REMEMBERED_USERNAME_KEY,
} from '@/lib/auth/browser-storage';
import { sameSteemAccount } from '@/lib/steem/username';
import { ClaimRewardsReauthDialog } from '@/components/wallet/claim-rewards-reauth-dialog';
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
  const [reauthOpen, setReauthOpen] = useState(false);

  if (loading || !isMyAccount || !balance || claimed || !hasPendingRewards(balance)) {
    return null;
  }

  // Restore the opt-in remembered posting key into the session right before a
  // claim (issue #363): Redux keys are memory-only, so a page refresh leaves
  // the wallet page "logged in" (remembered username) but keyless. The
  // device-stored posting key — whose storage is the documented, accepted
  // trade-off in lib/auth/browser-storage.ts — is verified against the chain
  // account's posting authority before it is trusted for signing.
  const tryRestoreRememberedPostingKey = async (): Promise<string | null> => {
    try {
      const saved = localStorage.getItem(REMEMBERED_POSTING_KEY_KEY);
      const savedUser = localStorage.getItem(REMEMBERED_USERNAME_KEY);
      if (!saved || !savedUser || !sameSteemAccount(savedUser, username)) return null;
      const accountsResp = await apiClient.getAccounts([username], { fresh: true });
      const account = accountsResp.accounts?.[0];
      const expectedPub = account?.posting?.key_auths?.[0]?.[0];
      if (!expectedPub || !SteemSigner.verifyPrivateKey(saved, expectedPub)) return null;
      return saved;
    } catch {
      return null;
    }
  };

  // Legacy parity (UserWallet.jsx claimRewards mapDispatchToProps + the
  // claimbox button): one click broadcasts claim_reward_balance with the FULL
  // pending amounts of all three token types, exactly as the account reports
  // them (zero-valued strings included — the chain accepts). No confirmation
  // dialog in legacy; the button is disabled while a claim is in flight.
  // Deviation: legacy's click handler only claimed when reward_vesting_steem
  // was non-zero (a liquid-only claimbox button was a silent no-op); here any
  // pending reward the banner shows can be claimed.
  //
  // Issue #363: the button is now always clickable (legacy never disabled it
  // for missing keys). With no session posting key it first tries the
  // device-remembered posting key, then opens the posting re-auth dialog —
  // the user signs in with a posting key or master password and the claim
  // resumes in place. The chain only accepts posting authority here (verified
  // via database_api.get_required_signatures): an active/owner-only session
  // cannot claim, so it is routed through the dialog too.
  const handleClaim = async () => {
    if (claiming || !username) return;
    setClaimError(null);

    let key = postingKey;
    if (!key) {
      key = await tryRestoreRememberedPostingKey();
    }
    if (!key) {
      setReauthOpen(true);
      return;
    }

    setClaiming(true);
    try {
      const signedTx = await SteemSigner.signClaimRewardBalance(
        username,
        balance.reward_steem_balance,
        balance.reward_sbd_balance,
        balance.reward_vesting_balance,
        key
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
        disabled={claiming}
        aria-describedby={postingKey ? undefined : 'claim-needs-key-hint'}
      >
        {claiming ? t('claiming') : t('claimRewards')}
      </Button>
      {!postingKey && (
        <span id="claim-needs-key-hint" className="text-muted-foreground text-sm">
          {t('claimNeedPostingKey')}
        </span>
      )}
      {claimError && <span className="text-destructive text-sm">{claimError}</span>}
      <ClaimRewardsReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        username={username}
        onAuthenticated={() => {
          // Redux now holds the posting key (password logins derive all four
          // role keys; a posting-key login stores it directly). The banner
          // re-renders keyful; the user clicks Redeem Rewards to claim.
          setReauthOpen(false);
        }}
      />
    </div>
  );
}
