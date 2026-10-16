'use client';

import { useTranslations } from 'next-intl';
import { LoginForm } from '@/components/auth/login-form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { normalizeSteemUsername } from '@/lib/steem/username';

export interface ClaimRewardsReauthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Account whose rewards would be claimed (normalized). */
  username: string;
  /**
   * Shown above the form — e.g. after a memo-only login, which carries no
   * key able to sign claim_reward_balance.
   */
  errorMessage?: string | null;
  /**
   * Fired after a successful login. The banner checks the refreshed Redux
   * state for a signing key (posting/active/owner) and decides whether the
   * dialog may close.
   */
  onAuthenticated: () => void;
}

/**
 * Posting-authority re-auth for the claim-rewards flow (issue #363).
 *
 * Chain semantics: posting-class operations such as claim_reward_balance
 * accept the posting, active, OR owner authority — the consensus authority
 * check falls back posting -> active -> owner (steem/protocol
 * transaction_util.hpp verify_authority). This dialog therefore accepts a
 * posting key, the master password (which derives all four role keys), or an
 * active/owner key; only a memo key (which signs nothing) is rejected by the
 * form's requiredAuthTypes gate. The copy still recommends the posting key or
 * password: least-privilege habit for manual input.
 * "Remember username" is shown so the device-stored posting key can also be
 * (re)saved for future one-click claims.
 */
export function ClaimRewardsReauthDialog({
  open,
  onOpenChange,
  username,
  errorMessage,
  onAuthenticated,
}: ClaimRewardsReauthDialogProps) {
  const t = useTranslations('wallet');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('claimRewards')}</DialogTitle>
          <DialogDescription>{t('claimNeedPostingKey')}</DialogDescription>
        </DialogHeader>
        {errorMessage ? (
          <p role="alert" className="text-destructive text-sm">
            {errorMessage}
          </p>
        ) : null}
        <LoginForm
          embedded
          fixedUsername={normalizeSteemUsername(username)}
          showRememberUser={true}
          requiredAuthTypes={['posting']}
          onLoginSuccess={onAuthenticated}
        />
      </DialogContent>
    </Dialog>
  );
}
