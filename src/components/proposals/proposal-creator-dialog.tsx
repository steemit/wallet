'use client';

import { useMemo, useState } from 'react';
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
import { normalizeSteemUsername, sameSteemAccount } from '@/lib/steem/username';
import { useSessionSigning } from '@/hooks/use-session-signing';
import type { Operation } from '@/lib/steem/types';

function defaultDateTimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function normalizeChainDateTime(value: string): string {
  if (!value) return value;
  if (value.length === 16) return `${value}:00`;
  return value;
}

type ProposalCreatorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string | null;
  treasuryFeeSbd: string | null;
  onSuccess: () => void;
  onNeedLogin: () => void;
};

export function ProposalCreatorDialog({
  open,
  onOpenChange,
  username,
  treasuryFeeSbd,
  onSuccess,
  onNeedLogin,
}: ProposalCreatorDialogProps) {
  const t = useTranslations('wallet.proposalsPage');
  const tWallet = useTranslations('wallet');
  // Unified signing entry (A6-T4): privateKey sessions sign through the
  // facade's legacy backend exactly as before; vault identity sessions get
  // the per-key password dialog.
  const signing = useSessionSigning();
  const [submitting, setSubmitting] = useState(false);
  /** Classic re-auth for a privateKey session that lacks an active/owner key. */
  const [reauthOpen, setReauthOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [dailyAmount, setDailyAmount] = useState('');
  const [startDate, setStartDate] = useState(defaultDateTimeLocal);
  const [endDate, setEndDate] = useState(defaultDateTimeLocal);
  const [rawPermlink, setRawPermlink] = useState('');
  const [creator, setCreator] = useState(username ?? '');
  const [receiver, setReceiver] = useState(username ?? '');

  const { permlink, parsedCreator } = useMemo(() => {
    const raw = rawPermlink.trim();
    const match = raw.match(/@([\w.-]+)\/([\w-]+)/);
    if (match) {
      return { permlink: match[2] ?? '', parsedCreator: match[1] ?? '' };
    }
    return { permlink: raw, parsedCreator: '' };
  }, [rawPermlink]);

  const resolvedCreator = creator.trim() || parsedCreator || username || '';
  const resolvedReceiver = receiver.trim() || resolvedCreator;
  const resolvedPermlink = permlink.trim();

  const isValid = useMemo(() => {
    const start = Date.parse(normalizeChainDateTime(startDate));
    const end = Date.parse(normalizeChainDateTime(endDate));
    const amount = parseFloat(dailyAmount);
    return (
      title.trim() !== '' &&
      resolvedPermlink !== '' &&
      resolvedCreator !== '' &&
      resolvedReceiver !== '' &&
      Number.isFinite(amount) &&
      amount > 0 &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start < end
    );
  }, [
    title,
    resolvedPermlink,
    resolvedCreator,
    resolvedReceiver,
    dailyAmount,
    startDate,
    endDate,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) {
      onNeedLogin();
      return;
    }
    if (!isValid) {
      toast.error(t('createFillAllFields'));
      return;
    }
    if (!sameSteemAccount(resolvedCreator, username)) {
      toast.error(t('createMustSignAsCreator'));
      return;
    }

    setSubmitting(true);
    try {
      const dailyPay = `${parseFloat(dailyAmount).toFixed(3)} SBD`;
      // The chain only accepts canonical lowercase account names; the typed or
      // permlink-parsed creator/receiver may carry mixed case or a leading '@'.
      const creatorName = normalizeSteemUsername(resolvedCreator);
      const receiverName = normalizeSteemUsername(resolvedReceiver);
      // The exact operation tuple SteemSigner.signCreateProposal built
      // internally — field order byte-identical. create_proposal is an
      // active-class operation.
      const operations: Operation[] = [
        [
          'create_proposal',
          {
            creator: creatorName,
            receiver: receiverName,
            start_date: normalizeChainDateTime(startDate),
            end_date: normalizeChainDateTime(endDate),
            daily_pay: dailyPay,
            subject: title.trim(),
            permlink: resolvedPermlink,
          },
        ],
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
        toast.error(t('createFailed'));
        return;
      }

      const res = await apiClient.broadcastProposalCreate(outcome.result.signedTx, username);
      if (!res.success) {
        toast.error(res.error ?? t('createFailed'));
        return;
      }
      toast.success(t('createSuccess'));
      onOpenChange(false);
      setTitle('');
      setDailyAmount('');
      setRawPermlink('');
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('createHeader')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-2">
            <Label htmlFor="proposal-title">{t('createTitle')}</Label>
            <Input
              id="proposal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proposal-daily">{t('createDailyAmount')}</Label>
            <Input
              id="proposal-daily"
              type="number"
              step="0.001"
              min="0"
              placeholder="100.000"
              value={dailyAmount}
              onChange={(e) => setDailyAmount(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proposal-start">{t('createStartDate')}</Label>
            <Input
              id="proposal-start"
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proposal-end">{t('createEndDate')}</Label>
            <Input
              id="proposal-end"
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proposal-permlink">{t('createPermlink')}</Label>
            <p className="text-xs text-muted-foreground">{t('createPermlinkNote')}</p>
            <Input
              id="proposal-permlink"
              value={rawPermlink}
              onChange={(e) => setRawPermlink(e.target.value)}
              placeholder={t('createPermlinkPlaceholder')}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proposal-creator">{t('createCreator')}</Label>
            <p className="text-xs text-muted-foreground">{t('createCreatorNote')}</p>
            <Input
              id="proposal-creator"
              value={creator}
              onChange={(e) => setCreator(e.target.value)}
              placeholder={t('createCreatorPlaceholder')}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proposal-receiver">{t('createReceiver')}</Label>
            <p className="text-xs text-muted-foreground">{t('createReceiverNote')}</p>
            <Input
              id="proposal-receiver"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              placeholder={t('createReceiverPlaceholder')}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proposal-fee">{t('createFee')}</Label>
            <Input
              id="proposal-fee"
              value={treasuryFeeSbd ? `${treasuryFeeSbd} SBD` : '—'}
              disabled
              readOnly
            />
            {treasuryFeeSbd && (
              <p className="text-xs text-muted-foreground">
                {t('createFeeNote', { fee: treasuryFeeSbd })}
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={!isValid || submitting}>
            {submitting ? t('createSubmitting') : t('createSubmit')}
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
