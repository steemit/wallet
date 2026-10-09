'use client';

import { useState, useTransition, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useActiveSigningKey } from '@/hooks/use-auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import type { SignedTransaction } from '@/lib/steem/types';
import { Button } from '@/components/ui/button';
import {
  ModalFormActions,
  modalFormActionButtonClassName,
} from '@/components/ui/modal-form-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchAccounts } from '@/lib/steem/accounts-client';
import { normalizeSteemUsername } from '@/lib/steem/username';
import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import {
  validateAccountName,
  validateMemoField,
  parseTransferAmountInput,
  isVerifiedExchange,
  isBadActor,
  findSimilarExchange,
} from '@/lib/wallet/transfer-validation';
import {
  transfersPathForUsername,
  type WalletTransferType,
} from '@/lib/wallet/wallet-modal-search-params';
import { userActionRecord } from '@/lib/analytics/overseer';

export type TransferFormVariant = 'page' | 'dialog';

export interface TransferFormProps {
  variant?: TransferFormVariant;
  /** Initial asset from URL / balance row (STEEM, SBD, or VESTS for power-up entry). */
  initialAsset?: 'STEEM' | 'SBD' | 'VESTS';
  /** transfer = to another account; savings / savings_withdraw = self operations. */
  initialTransferType?: WalletTransferType;
  onSuccess?: () => void;
  onCancel?: () => void;
}

interface SenderBalances {
  steem: number;
  sbd: number;
  savingsSteem: number;
  savingsSbd: number;
}

/** Snapshot of a validated transfer, shown for review before broadcasting. */
interface TransferDraft {
  amountStr: string;
  amountValue: number;
  recipient: string;
  memo: string;
}

/** A single label/value row in the pre-broadcast review dialog. */
function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-sm font-medium break-all text-right">{value}</span>
    </div>
  );
}

export function TransferForm({
  variant = 'page',
  initialAsset = 'STEEM',
  initialTransferType = 'transfer',
  onSuccess,
  onCancel,
}: TransferFormProps) {
  const t = useTranslations('transfer');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  const signingKey = useActiveSigningKey();
  const [isPending, startTransition] = useTransition();

  const [transferType, setTransferType] = useState<WalletTransferType>(initialTransferType);
  const [asset, setAsset] = useState<'STEEM' | 'SBD'>(initialAsset === 'SBD' ? 'SBD' : 'STEEM');
  const [formData, setFormData] = useState({ to: '', amount: '', memo: '' });
  const [error, setError] = useState<string>('');
  const [toError, setToError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [senderBalances, setSenderBalances] = useState<SenderBalances | null>(null);
  /** Sender's on-chain memo_key (from the same accounts fetch as balances);
   * powers the legacy memo master-password leak check. */
  const [senderMemoKey, setSenderMemoKey] = useState<string | null>(null);
  /** Legacy exchange warnings: verified exchange / similar name / bad actor. */
  const [exchangeKind, setExchangeKind] = useState<
    'verified' | 'suspicious' | 'badactor' | null
  >(null);
  const [similarExchange, setSimilarExchange] = useState<{
    exchange: string;
    similarity: number;
  } | null>(null);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [draft, setDraft] = useState<TransferDraft | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setTransferType(initialTransferType);
      setAsset(initialAsset === 'SBD' ? 'SBD' : 'STEEM');
    });
    return () => cancelAnimationFrame(id);
  }, [initialAsset, initialTransferType]);

  // Load the sender's balances for available-balance display and the
  // insufficient-funds check (legacy Transfer.jsx insufficientFunds).
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAccounts([username]);
        if (cancelled || !data.success) return;
        const acc = data.accounts?.[0];
        if (!acc) return;
        setSenderBalances({
          steem: parseAssetAmount(acc.balance ?? '0'),
          sbd: parseAssetAmount(acc.sbd_balance ?? '0'),
          savingsSteem: parseAssetAmount(acc.savings_balance ?? '0'),
          savingsSbd: parseAssetAmount(acc.savings_sbd_balance ?? '0'),
        });
        setSenderMemoKey(acc.memo_key ?? null);
      } catch {
        /* balance hints are best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Live recipient validation (legacy Transfer.jsx): name format (derived
  // synchronously), existence + exchange/bad-actor warnings (async, debounced).
  // Only for direct transfers to other accounts.
  const toFormatError = useMemo(() => {
    if (transferType !== 'transfer') return '';
    const target = formData.to.trim().replace(/^@/, '').toLowerCase();
    if (!target) return '';
    const code = validateAccountName(target, true);
    return code ? t(`errors.${code}`) : '';
  }, [formData.to, transferType, t]);

  useEffect(() => {
    if (transferType !== 'transfer') return;
    let active = true;
    const timer = setTimeout(() => {
      const target = formData.to.trim().replace(/^@/, '').toLowerCase();
      if (!target || validateAccountName(target, true)) {
        setToError('');
        setExchangeKind(null);
        setSimilarExchange(null);
        setWarningsAcknowledged(false);
        return;
      }
      void (async () => {
        try {
          const data = await fetchAccounts([target]);
          if (!active) return;
          const exists = data.success && !!data.accounts?.[0];
          if (!exists) {
            setToError(t('errors.account_not_found'));
            setExchangeKind(null);
            setSimilarExchange(null);
            return;
          }
          setToError('');
          if (isVerifiedExchange(target)) {
            setExchangeKind('verified');
            setSimilarExchange(null);
          } else if (isBadActor(target)) {
            setExchangeKind('badactor');
            setSimilarExchange(null);
          } else {
            const similar = findSimilarExchange(target);
            if (similar) {
              setExchangeKind('suspicious');
              setSimilarExchange(similar);
            } else {
              setExchangeKind(null);
              setSimilarExchange(null);
            }
          }
        } catch {
          /* existence check is best-effort */
        }
      })();
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [formData.to, transferType, t]);

  // Live memo key-leak check (legacy validate_memo_field): WIF patterns plus
  // the master-password derivation against the sender's memo_key. The seed
  // uses the normalized username (master-password derivations are lowercase).
  const memoError = useMemo(() => {
    const leak = formData.memo
      ? validateMemoField(
          formData.memo,
          username ? normalizeSteemUsername(username) : undefined,
          senderMemoKey ?? undefined
        )
      : null;
    return leak ? t(`errors.${leak}`) : '';
  }, [formData.memo, username, senderMemoKey, t]);

  const availableForSelection = useMemo(() => {
    if (!senderBalances) return null;
    if (transferType === 'savings_withdraw') {
      return asset === 'SBD' ? senderBalances.savingsSbd : senderBalances.savingsSteem;
    }
    return asset === 'SBD' ? senderBalances.sbd : senderBalances.steem;
  }, [senderBalances, transferType, asset]);

  const amountExceedsBalance = useMemo(() => {
    if (availableForSelection === null) return false;
    const value = parseFloat(formData.amount);
    if (!Number.isFinite(value) || value <= 0) return false;
    // Compare at the 3-decimal precision that will actually be broadcast:
    // toFixed(3) happens at submit time, so comparing the raw value here
    // could pass an amount (e.g. 99.9996 vs 99.9996 balance) that rounds up
    // (100.000) and then fails on-chain for exceeding the balance.
    const normalized = parseFloat(value.toFixed(3));
    return normalized > availableForSelection;
  }, [availableForSelection, formData.amount]);

  /** Legacy: verified exchanges require a memo on direct transfers. */
  const exchangeMemoMissing =
    transferType === 'transfer' &&
    exchangeKind === 'verified' &&
    !formData.memo.trim();

  const submitBlockedByWarnings =
    transferType === 'transfer' && exchangeKind !== null && !warningsAcknowledged;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const amountSuffix = asset === 'SBD' ? 'SBD' : 'STEEM';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !signingKey) {
      setError('Not authenticated');
      return;
    }

    // Strict syntax + explicit 3-decimal rejection (power-up parity);
    // the balance check below then compares at the same 3-decimal
    // precision the broadcast will use.
    const parsed = parseTransferAmountInput(formData.amount);
    if (!parsed.ok) {
      setError(t(`errors.${parsed.issue}`));
      return;
    }
    const amountValue = parsed.value;
    if (amountExceedsBalance) {
      setError(t('errors.insufficient_funds'));
      return;
    }

    let recipient = username;
    if (transferType === 'transfer') {
      const target = formData.to.trim().replace(/^@/, '').toLowerCase();
      if (!target) {
        setError('Please enter a recipient username');
        return;
      }
      const nameError = validateAccountName(target, true);
      if (nameError) {
        setError(t(`errors.${nameError}`));
        return;
      }
      if (toError) {
        setError(toError);
        return;
      }
      if (toFormatError) {
        setError(toFormatError);
        return;
      }
      if (exchangeMemoMissing) {
        setError(t('errors.verified_exchange_no_memo'));
        return;
      }
      if (submitBlockedByWarnings) {
        setError(t('errors.acknowledge_warnings'));
        return;
      }
      recipient = target;
    }

    const memoLeak = formData.memo
      ? validateMemoField(
          formData.memo,
          username ? normalizeSteemUsername(username) : undefined,
          senderMemoKey ?? undefined
        )
      : null;
    if (memoLeak) {
      setError(t(`errors.${memoLeak}`));
      return;
    }

    // Validation passed: show the pre-broadcast review instead of signing.
    const amountStr = `${amountValue.toFixed(3)} ${amountSuffix}`;
    setDraft({
      amountStr,
      amountValue,
      recipient,
      memo: formData.memo,
    });
    setPreviewOpen(true);
  };

  const handleConfirm = async () => {
    if (!username || !signingKey || !draft) {
      setError('Not authenticated');
      return;
    }
    setError('');
    setIsLoading(true);

    try {
      let signedTx: SignedTransaction;

      if (transferType === 'transfer') {
        signedTx = await SteemSigner.signTransfer(
          username,
          draft.recipient,
          draft.amountStr,
          draft.memo,
          signingKey
        );
      } else if (transferType === 'savings') {
        signedTx = await SteemSigner.signTransferToSavings(
          username,
          username,
          draft.amountStr,
          draft.memo,
          signingKey
        );
      } else if (transferType === 'savings_withdraw') {
        const requestId = Date.now() >>> 0;
        signedTx = await SteemSigner.signTransferFromSavings(
          username,
          username,
          draft.amountStr,
          draft.memo,
          requestId,
          signingKey
        );
      } else {
        setError('Unsupported operation');
        setIsLoading(false);
        return;
      }

      const response = await apiClient.broadcastTransfer(signedTx, username);

      if (!response.success) {
        setError(response.error || t('transferError'));
        setIsLoading(false);
        return;
      }

      const recipient = transferType === 'transfer' ? draft.recipient : username;
      const overseerAction =
        transferType === 'transfer'
          ? 'transfer'
          : transferType === 'savings'
            ? 'transfer_to_savings'
            : 'transfer_from_savings';
      userActionRecord(overseerAction, {
        transferCoin: amountSuffix,
        amount: draft.amountValue,
        from: username,
        to: recipient,
      });

      setIsLoading(false);
      setPreviewOpen(false);
      setDraft(null);
      startTransition(() => {
        if (onSuccess) {
          onSuccess();
        } else {
          router.push(transfersPathForUsername(username));
        }
      });
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error('Transfer error:', err);
      setError('Failed to process transfer');
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
    else router.back();
  };

  const showRecipient = transferType === 'transfer';
  const showMemo =
    transferType === 'transfer' ||
    transferType === 'savings' ||
    transferType === 'savings_withdraw';
  const titleKey =
    transferType === 'savings'
      ? 'Transfer to savings'
      : transferType === 'savings_withdraw'
        ? 'Withdraw from savings'
        : t('title');

  const formBody = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {variant === 'page' && transferType === 'transfer' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <Label>Asset</Label>
            <select
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={asset}
              onChange={(e) => setAsset(e.target.value as 'STEEM' | 'SBD')}
              disabled={isLoading || isPending}
            >
              <option value="STEEM">STEEM</option>
              <option value="SBD">SBD</option>
            </select>
          </div>
        </div>
      )}

      {showRecipient && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="to" className="text-base">
            {t('to')}
          </Label>
          <Input
            type="text"
            id="to"
            name="to"
            value={formData.to}
            onChange={handleChange}
            required
            placeholder="Enter recipient username"
            disabled={isLoading || isPending}
          />
          {(toFormatError || toError) && (
            <p className="text-destructive text-sm">{toFormatError || toError}</p>
          )}
        </div>
      )}

      {transferType === 'transfer' && exchangeKind === 'verified' && (
        <div className="border-destructive/40 bg-destructive/10 rounded-md border p-4">
          <p className="text-destructive text-sm font-semibold">{t('exchangeAlertTitle')}</p>
          <ul className="text-destructive mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>{t('exchangeAlertMemo')}</li>
            <li>{t('exchangeAlertSuspended')}</li>
            <li>{t('exchangeAlertAsset', { asset: amountSuffix })}</li>
          </ul>
        </div>
      )}

      {transferType === 'transfer' && exchangeKind === 'suspicious' && similarExchange && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {t('similarAccountTitle')}
          </p>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
            {t('similarAccountWarning', {
              accountName: similarExchange.exchange,
              similarity: similarExchange.similarity,
            })}
          </p>
        </div>
      )}

      {transferType === 'transfer' && exchangeKind === 'badactor' && (
        <div className="border-destructive/40 bg-destructive/10 rounded-md border p-4">
          <p className="text-destructive text-sm">{t('exchangeMisspelling')}</p>
        </div>
      )}

      {transferType === 'transfer' && exchangeKind !== null && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={warningsAcknowledged}
            onCheckedChange={(checked) => setWarningsAcknowledged(checked === true)}
          />
          <span>{t('acknowledgeWarnings')}</span>
        </label>
      )}

      {transferType === 'transfer' && exchangeMemoMissing && (
        <p className="text-destructive text-sm">{t('errors.verified_exchange_no_memo')}</p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="amount" className="text-base">
          {t('amount')}
        </Label>
        <Input
          type="number"
          id="amount"
          name="amount"
          value={formData.amount}
          onChange={handleChange}
          required
          step="0.001"
          min="0"
          placeholder={`e.g. 1.000 ${amountSuffix}`}
          disabled={isLoading || isPending}
        />
        <p className="text-muted-foreground text-sm">Amount in {amountSuffix}</p>
        {availableForSelection !== null && (
          <button
            type="button"
            className="text-primary cursor-pointer self-start text-sm hover:underline"
            onClick={() =>
              setFormData((prev) => ({
                ...prev,
                amount: availableForSelection.toFixed(3),
              }))
            }
          >
            {t('availableBalance', {
              amount: availableForSelection.toFixed(3),
              asset: amountSuffix,
            })}
          </button>
        )}
        {amountExceedsBalance && (
          <p className="text-destructive text-sm">{t('errors.insufficient_funds')}</p>
        )}
      </div>

      {showMemo && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="memo" className="text-base">
            {t('memo')}
          </Label>
          <Input
            type="text"
            id="memo"
            name="memo"
            value={formData.memo}
            onChange={handleChange}
            placeholder="Optional memo (max 2048 bytes)"
            maxLength={2048}
            disabled={isLoading || isPending}
          />
          {memoError && <p className="text-destructive text-sm">{memoError}</p>}
        </div>
      )}

      {error && (
        <div className="border-destructive/20 bg-destructive/10 rounded-md border p-4">
          <p className="text-destructive text-sm font-medium">{error}</p>
        </div>
      )}

      <ModalFormActions className="pt-4">
        <Button
          type="submit"
          disabled={
            isLoading ||
            isPending ||
            !!toError ||
            !!toFormatError ||
            !!memoError ||
            submitBlockedByWarnings
          }
          className={modalFormActionButtonClassName}
        >
          {isLoading || isPending ? tCommon('loading') : t('continueButton')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleCancel}
          disabled={isLoading || isPending}
          className={modalFormActionButtonClassName}
        >
          {tCommon('cancel')}
        </Button>
      </ModalFormActions>
    </form>
  );

  const confirmDialog = (
    <Dialog
      open={previewOpen}
      onOpenChange={(next) => {
        if (!isLoading) setPreviewOpen(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titleKey}</DialogTitle>
          <DialogDescription>{t('confirmDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <PreviewRow label={t('confirmFrom')} value={username ?? ''} />
          <PreviewRow label={t('confirmTo')} value={draft?.recipient ?? ''} />
          <PreviewRow label={t('confirmAmount')} value={draft?.amountStr ?? ''} />
          {draft?.memo ? <PreviewRow label={t('confirmMemo')} value={draft.memo} /> : null}
          {error && (
            <div className="border-destructive/20 bg-destructive/10 rounded-md border p-4">
              <p className="text-destructive text-sm font-medium">{error}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPreviewOpen(false)}
            disabled={isLoading}
            className={modalFormActionButtonClassName}
          >
            {t('backButton')}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading || isPending}
            className={modalFormActionButtonClassName}
          >
            {isLoading || isPending ? tCommon('loading') : t('confirmButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (variant === 'dialog') {
    return (
      <div className="px-1 py-1">
        <h2 className="mb-4 text-lg font-semibold">{titleKey}</h2>
        {formBody}
        {confirmDialog}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-lg px-4">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">{titleKey}</CardTitle>
        </CardHeader>
        <CardContent>{formBody}</CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}
