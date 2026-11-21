'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoginForm } from '@/components/auth/login-form';
import { apiClient } from '@/lib/steem/client';
import { normalizeSteemUsername } from '@/lib/steem/username';
import { useSessionSigning } from '@/hooks/use-session-signing';
import type { Operation } from '@/lib/steem/types';

type ProposalRemoveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: number;
  username: string | null;
  onSuccess: () => void;
  onNeedLogin: () => void;
};

export function ProposalRemoveDialog({
  open,
  onOpenChange,
  proposalId,
  username,
  onSuccess,
  onNeedLogin,
}: ProposalRemoveDialogProps) {
  const t = useTranslations('wallet.proposalsPage');
  const tWallet = useTranslations('wallet');
  // Unified signing entry (A6-T4): privateKey sessions sign through the
  // facade's legacy backend exactly as before; vault identity sessions get
  // the per-key password dialog.
  const signing = useSessionSigning();
  const [confirmId, setConfirmId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** Classic re-auth for a privateKey session that lacks an active/owner key. */
  const [reauthOpen, setReauthOpen] = useState(false);

  const idMatches = confirmId.trim() === String(proposalId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) {
      onNeedLogin();
      return;
    }
    if (!idMatches) {
      toast.error(t('removeIdMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      // The chain only accepts canonical lowercase account names. Login-time
      // normalization makes the session username lowercase today, but the
      // submit site normalizes again as defense-in-depth — mirrors
      // proposal-creator-dialog (#341 residual).
      const ownerName = normalizeSteemUsername(username);
      // The exact operation tuple SteemSigner.signRemoveProposal built
      // internally. remove_proposal is an active-class operation.
      const operations: Operation[] = [
        ['remove_proposal', { proposal_owner: ownerName, proposal_ids: [proposalId] }],
      ];

      const outcome = await signing.sign({
        operations,
        accountName: username,
        role: 'active',
      });

      if (outcome.status === 'cancelled') {
        // User aborted the vault dialog — back to the form, no error.
        return;
      }
      if (outcome.status === 'needsClassicReauth') {
        // privateKey session without an active/owner key: the classic re-auth
        // dialog locked to this account.
        setReauthOpen(true);
        return;
      }
      if (outcome.status === 'error') {
        toast.error(t('removeFailed'));
        return;
      }

      const res = await apiClient.broadcastProposalRemove(outcome.result.signedTx, username);
      if (!res.success) {
        toast.error(res.error ?? t('removeFailed'));
        return;
      }
      toast.success(t('removeSuccess'));
      setConfirmId('');
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('removeFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('removeTitle')}</DialogTitle>
          <DialogDescription>{t('removeDescription')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-2">
            <Label htmlFor="confirm-proposal-id">{t('removeConfirmId')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('removeProposalId')}: #{proposalId}
            </p>
            <Input
              id="confirm-proposal-id"
              inputMode="numeric"
              value={confirmId}
              onChange={(e) => setConfirmId(e.target.value)}
              disabled={submitting}
            />
          </div>
          <Button type="submit" variant="destructive" className="w-full" disabled={!idMatches || submitting}>
            {submitting ? t('removeSubmitting') : t('removeButton')}
          </Button>
        </form>
      </DialogContent>
      </Dialog>

      <Dialog open={reauthOpen} onOpenChange={setReauthOpen}>
        <DialogContent className="z-[60] max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tWallet('reauthTitle')}</DialogTitle>
            <DialogDescription>{tWallet('reauthDescription')}</DialogDescription>
          </DialogHeader>
          <LoginForm
            embedded
            fixedUsername={username ?? ''}
            requiredAuthTypes={['active']}
            onLoginSuccess={() => setReauthOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {signing.dialog}
    </>
  );
}
