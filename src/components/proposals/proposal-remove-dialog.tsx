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
import { apiClient, SteemSigner } from '@/lib/steem/client';
import { useActiveSigningKey } from '@/hooks/use-auth';

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
  const activeKey = useActiveSigningKey();
  const [confirmId, setConfirmId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const idMatches = confirmId.trim() === String(proposalId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !activeKey) {
      onNeedLogin();
      return;
    }
    if (!idMatches) {
      toast.error(t('removeIdMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      const signedTx = await SteemSigner.signRemoveProposal(username, [proposalId], activeKey);
      const res = await apiClient.broadcastProposalRemove(signedTx, username);
      if (!res.success) {
        toast.error(res.error ?? res.details ?? t('removeFailed'));
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
  );
}
