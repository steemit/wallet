'use client';

import { useRef, useState } from 'react';
import { useStore } from 'react-redux';
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
import type { RootState } from '@/lib/store';
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
  const { postingKey, activeKey, ownerKey } = useAuthRoleKeys();
  const store = useStore<RootState>();
  // Any of these can sign claim_reward_balance (see the comment above
  // handleClaim); the hint and its aria link only apply when none exists.
  const hasSigningKey = !!(postingKey || activeKey || ownerKey);

  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthError, setReauthError] = useState<string | null>(null);
  const claimingRef = useRef(false);

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
  // Issue #363: the button is always clickable (legacy never disabled it
  // for missing keys). Chain semantics for posting-class operations: the
  // consensus authority check falls back posting -> active -> owner
  // (steem/protocol transaction_util.hpp verify_authority; claims signed
  // with active keys are accepted on chain), so ANY session key can sign
  // the claim. Resolution prefers the least-privileged key first:
  //   session posting key -> device-remembered posting key (chain-verified)
  //   -> session active key -> session owner key -> posting re-auth dialog.
  // The dialog's copy still recommends a posting key or the password
  // (least-privilege habit for manual input), but an active/owner key
  // entered there works on chain just the same.
  const handleClaim = async () => {
    // Synchronous in-flight guard: the key-restore await below would otherwise
    // let a fast double-click slip past the async `claiming` state and sign
    // twice (the chain rejects the duplicate, but the user sees a spurious
    // error).
    if (claimingRef.current || !username) return;
    claimingRef.current = true;
    setClaimError(null);
    try {
      let key = postingKey;
      if (!key) {
        key = await tryRestoreRememberedPostingKey();
      }
      if (!key) key = activeKey;
      if (!key) key = ownerKey;
      if (!key) {
        setReauthError(null);
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
    } finally {
      claimingRef.current = false;
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
        aria-describedby={hasSigningKey ? undefined : 'claim-needs-key-hint'}
      >
        {claiming ? t('claiming') : t('claimRewards')}
      </Button>
      {!hasSigningKey && (
        <span id="claim-needs-key-hint" className="text-muted-foreground text-sm">
          {t('claimNeedPostingKey')}
        </span>
      )}
      {claimError && <span className="text-destructive text-sm">{claimError}</span>}
      <ClaimRewardsReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        username={username}
        errorMessage={reauthError}
        onAuthenticated={() => {
          // Post-login gate (defense in depth): the chain accepts posting,
          // active, or owner authority for claim_reward_balance, so any of
          // those keys lets the claim proceed. Only a login that carries none
          // of them (memo-key only, which can sign nothing) keeps the dialog
          // open with explicit guidance.
          const { postingKey: p, activeKey: a, ownerKey: o } = store.getState().auth;
          if (p || a || o) {
            setReauthError(null);
            setReauthOpen(false);
          } else {
            setReauthError(t('claimNeedPostingKey'));
          }
        }}
      />
    </div>
  );
}
