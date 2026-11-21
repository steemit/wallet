'use client';

import { useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { useAuthRoleKeys } from '@/hooks/use-auth-role-keys';
import { useSessionSigning } from '@/hooks/use-session-signing';
import {
  REMEMBERED_POSTING_KEY_KEY,
  REMEMBERED_USERNAME_KEY,
} from '@/lib/auth/browser-storage';
import { sameSteemAccount } from '@/lib/steem/username';
import { sessionKindOf } from '@/lib/store/slices/auth';
import { ClaimRewardsReauthDialog } from '@/components/wallet/claim-rewards-reauth-dialog';
import type { RootState } from '@/lib/store';
import type { Operation, SignedTransaction } from '@/lib/steem/types';
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
  // Unified signing entry (A6-T3b): privateKey sessions sign the session-key
  // cases through the facade's legacy backend exactly as before; vault
  // identity sessions get the per-key password dialog (see handleClaim for
  // where the privateKey-only remembered-key affordance still signs directly).
  const signing = useSessionSigning();
  const isVaultSession = sessionKindOf(store.getState().auth) === 'vault';
  // Any session key can sign claim_reward_balance (see the comment above
  // handleClaim); a vault session signs through the password dialog. The
  // hint and its aria link only apply when neither is available.
  const hasSigningKey =
    isVaultSession || !!(postingKey || activeKey || ownerKey);

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
  //   session posting key -> device-remembered posting key (chain-verified,
  //   privateKey sessions only, #375/#378) -> session active key -> session
  //   owner key -> posting re-auth dialog.
  // Since A6-T3b the SESSION-key cases sign through the unified session
  // signing entry with the posting floor: the hook resolves exactly the
  // session-key remainder of that chain (posting -> active -> owner) for
  // privateKey sessions and opens the per-key password dialog for vault
  // sessions. The remembered-key step sits BETWEEN posting and active, so it
  // still resolves and signs here, exactly as before — the restored key is
  // device storage material that exists in no session the unified entry can
  // read (its restore stays a privateKey-session affordance ONLY, invariant
  // 21: a vault session never reads the Legacy remembered key).
  const handleClaim = async () => {
    // Synchronous in-flight guard: the key-restore await below would otherwise
    // let a fast double-click slip past the async `claiming` state and sign
    // twice (the chain rejects the duplicate, but the user sees a spurious
    // error).
    if (claimingRef.current || !username) return;
    claimingRef.current = true;
    setClaimError(null);
    try {
      if (!postingKey && sessionKindOf(store.getState().auth) !== 'vault') {
        const remembered = await tryRestoreRememberedPostingKey();
        if (remembered) {
          await claimWithKey(remembered);
          return;
        }
      }

      // claim_reward_balance is a posting-class operation; the classifier
      // floors this request at 'posting' and the privateKey path resolves
      // the session key posting -> active -> owner (the #378 chain). The
      // tuple is byte-identical to what SteemSigner.signClaimRewardBalance
      // built (full pending amounts of all three token types, zero-valued
      // strings included).
      const operations: Operation[] = [
        [
          'claim_reward_balance',
          {
            account: username,
            reward_steem: balance.reward_steem_balance,
            reward_sbd: balance.reward_sbd_balance,
            reward_vests: balance.reward_vesting_balance,
          },
        ],
      ];
      const outcome = await signing.sign({
        operations,
        accountName: username,
        role: 'posting',
      });

      if (outcome.status === 'cancelled') {
        // User aborted the vault password dialog — quiet no-op, the banner
        // stays exactly as it was.
        return;
      }
      if (outcome.status === 'needsClassicReauth') {
        // privateKey session without any signing key: same re-auth dialog the
        // keyless flow always opened (a vault session never lands here — it
        // gets the password dialog above).
        setReauthError(null);
        setReauthOpen(true);
        return;
      }
      if (outcome.status === 'error') {
        setClaimError(t('claimFailed'));
        return;
      }

      await broadcastClaimTx(outcome.result.signedTx);
    } finally {
      claimingRef.current = false;
    }
  };

  /** Relay the signed claim and apply the shared success/error transitions. */
  const broadcastClaimTx = async (signedTx: SignedTransaction) => {
    setClaiming(true);
    try {
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

  /**
   * Pre-A6 direct signing for the device-remembered posting key (the ONE
   * remaining direct SteemSigner claim path — see handleClaim). The tuple is
   * byte-identical to what the unified entry builds for the session keys.
   */
  const claimWithKey = async (key: string) => {
    setClaiming(true);
    try {
      const signedTx = await SteemSigner.signClaimRewardBalance(
        username,
        balance.reward_steem_balance,
        balance.reward_sbd_balance,
        balance.reward_vesting_balance,
        key
      );
      await broadcastClaimTx(signedTx);
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
      {/* Vault password dialog for vault identity sessions (A6-T3b). */}
      {signing.dialog}
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
