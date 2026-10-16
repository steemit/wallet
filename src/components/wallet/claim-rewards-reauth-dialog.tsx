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
   * Shown above the form — e.g. after a login that still carries no posting
   * key (active/owner-only), which cannot sign claim_reward_balance.
   */
  errorMessage?: string | null;
  /**
   * Fired after a successful login. The banner checks the refreshed Redux
   * state for a posting key and decides whether the dialog may close.
   */
  onAuthenticated: () => void;
}

/**
 * Posting-authority re-auth for the claim-rewards flow (issue #363).
 *
 * The chain accepts ONLY posting authority for claim_reward_balance (verified
 * via database_api.get_required_signatures), so this dialog demands a posting
 * key or the master password (password logins derive all four role keys, so
 * posting is always covered). LoginForm's `requiredAuthTypes` gate is
 * hierarchical (owner covers active covers posting), so an active/owner-only
 * login is NOT rejected by the form — the banner's `onAuthenticated` gate
 * keeps this dialog open with `errorMessage` in that case.
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
