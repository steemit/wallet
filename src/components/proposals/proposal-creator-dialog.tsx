'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient, SteemSigner } from '@/lib/steem/client';
import { useActiveSigningKey } from '@/hooks/use-auth';

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
  const activeKey = useActiveSigningKey();
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [dailyAmount, setDailyAmount] = useState('');
  const [startDate, setStartDate] = useState(defaultDateTimeLocal);
  const [endDate, setEndDate] = useState(defaultDateTimeLocal);
  const [rawPermlink, setRawPermlink] = useState('');
  const [creator, setCreator] = useState('');
  const [receiver, setReceiver] = useState('');

  useEffect(() => {
    if (open && username) {
      setCreator((c) => c || username);
      setReceiver((r) => r || username);
    }
  }, [open, username]);

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
    if (!username || !activeKey) {
      onNeedLogin();
      return;
    }
    if (!isValid) {
      toast.error(t('createFillAllFields'));
      return;
    }
    if (resolvedCreator !== username) {
      toast.error(t('createMustSignAsCreator'));
      return;
    }

    setSubmitting(true);
    try {
      const dailyPay = `${parseFloat(dailyAmount).toFixed(3)} SBD`;
      const signedTx = await SteemSigner.signCreateProposal(
        resolvedCreator,
        resolvedReceiver,
        normalizeChainDateTime(startDate),
        normalizeChainDateTime(endDate),
        dailyPay,
        title.trim(),
        resolvedPermlink,
        activeKey
      );
      const res = await apiClient.broadcastProposalCreate(signedTx, username);
      if (!res.success) {
        toast.error(res.error ?? res.details ?? t('createFailed'));
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
  );
}
