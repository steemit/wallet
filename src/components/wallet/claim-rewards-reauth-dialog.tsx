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
   * Fired after a login that carries posting authority. The banner checks the
   * refreshed Redux state; the claim itself stays one click away.
   */
  onAuthenticated: () => void;
}

/**
 * Posting-authority re-auth for the claim-rewards flow (issue #363).
 *
 * The chain accepts ONLY posting authority for claim_reward_balance (verified
 * via database_api.get_required_signatures), so this dialog demands a posting
 * key or the master password (password logins derive all four role keys, so
 * posting is always covered). An active/owner-only login is REJECTED here —
 * unlike the transfer dialogs' `['active']` gate — because it cannot claim.
 * "Remember username" is shown so the device-stored posting key can also be
 * (re)saved for future one-click claims.
 */
export function ClaimRewardsReauthDialog({
  open,
  onOpenChange,
  username,
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
