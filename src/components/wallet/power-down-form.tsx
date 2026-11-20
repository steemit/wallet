'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useSessionSigning } from '@/hooks/use-session-signing';
import { useAccountData } from '@/hooks/use-account-data';
import { useGlobalProps } from '@/hooks/use-global-props';
import { LoginForm } from '@/components/auth/login-form';
import { apiClient } from '@/lib/steem/client';
import type { Operation } from '@/lib/steem/types';
import {
  formatSteemPowerDisplay,
  formatVestsAsset,
  steemPowerFromVests,
  vestsFromSteemPower,
} from '@/lib/wallet/vest-steem';
import {
  clampPowerDownVests,
  formatPowerDownWeeklySteem,
  getDefaultPowerDownVests,
  getPowerDownMaxVests,
  getPowerDownToWithdrawVests,
  getPowerDownWithdrawnVests,
  isPowerDownReserveWarning,
} from '@/lib/wallet/power-down';
import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import { Button } from '@/components/ui/button';
import {
  ModalFormActions,
  modalFormActionButtonClassName,
} from '@/components/ui/modal-form-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { transfersPathForUsername } from '@/lib/wallet/wallet-modal-search-params';
import { cn } from '@/lib/utils';
import { userActionRecord } from '@/lib/analytics/overseer';

export type PowerDownFormVariant = 'page' | 'dialog';

export interface PowerDownFormProps {
  variant?: PowerDownFormVariant;
  onSuccess?: () => void;
}

const LIQUID_TICKER = 'STEEM';
const VESTING_TOKEN = 'STEEM POWER';

export function PowerDownForm({ variant = 'page', onSuccess }: PowerDownFormProps) {
  const t = useTranslations('powerDown');
  const tWallet = useTranslations('wallet');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  // Unified signing entry (A6-T3a): privateKey sessions sign through the
  // facade's legacy backend exactly as before; vault identity sessions get
  // the per-key password dialog. `signing.dialog` mounts it.
  const signing = useSessionSigning();
  const [isPending, startTransition] = useTransition();

  const { data: account, refetch } = useAccountData();
  const { globalProps, loading: globalPropsLoading } = useGlobalProps();

  const [newWithdrawVests, setNewWithdrawVests] = useState(0);
  const [manualEntry, setManualEntry] = useState<string | false>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  /** Classic re-auth for a privateKey session that lacks an active/owner key. */
  const [reauthOpen, setReauthOpen] = useState(false);
  const initializedFor = useRef<string | null>(null);

  const maxVests = useMemo(
    () => (account ? getPowerDownMaxVests(account) : 0),
    [account]
  );

  useEffect(() => {
    if (!account || !globalProps || !username) return;
    if (initializedFor.current === username) return;
    initializedFor.current = username;
    setNewWithdrawVests(getDefaultPowerDownVests(account, globalProps));
    setManualEntry(false);
    setErrorMessage(undefined);
  }, [account, globalProps, username]);

  const formatSp = (vests: number) => {
    if (!globalProps) return '0.000';
    return formatSteemPowerDisplay(steemPowerFromVests(vests, globalProps));
  };

  const finishSuccess = () => {
    setIsLoading(false);
    void refetch();
    startTransition(() => {
      if (onSuccess) onSuccess();
      else if (username) {
        router.push(transfersPathForUsername(username));
      }
    });
  };

  const handleSliderChange = (value: number) => {
    setNewWithdrawVests(value);
    setManualEntry(false);
    setErrorMessage(undefined);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.preventDefault();
    const raw = event.target.value.replace(/,/g, '');
    let value = globalProps ? vestsFromSteemPower(parseFloat(raw), globalProps) : 0;
    if (!isFinite(value)) {
      value = newWithdrawVests;
    }
    setNewWithdrawVests(value);
    setManualEntry(event.target.value);
    setErrorMessage(undefined);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(undefined);
    setIsLoading(true);

    if (!username) {
      setErrorMessage(t('notAuthenticated'));
      setIsLoading(false);
      return;
    }

    if (!globalProps || !account) {
      setErrorMessage(t('loadError'));
      setIsLoading(false);
      return;
    }

    try {
      const withdraw = clampPowerDownVests(newWithdrawVests, maxVests);
      const vests = formatVestsAsset(withdraw);

      // Build the exact operation tuple SteemSigner.signPowerDown used to
      // build internally — the signing itself now goes through the unified
      // session signing entry (A6-T3a).
      const operations: Operation[] = [
        [
          'withdraw_vesting',
          {
            account: username,
            vesting_shares: vests,
          },
        ],
      ];

      // withdraw_vesting is an active-class operation. privateKey sessions
      // sign through the facade's legacy backend (active key, owner fallback
      // — the useActiveSigningKey rule); vault sessions get the per-key
      // password dialog.
      const outcome = await signing.sign({
        operations,
        accountName: username,
        role: 'active',
      });

      if (outcome.status === 'cancelled') {
        // User aborted the vault dialog — back to the form, no error.
        setIsLoading(false);
        return;
      }
      if (outcome.status === 'needsClassicReauth') {
        // privateKey session without an active/owner key: the classic
        // re-auth dialog (the same gate the wallet modal shows up front).
        setIsLoading(false);
        setReauthOpen(true);
        return;
      }
      if (outcome.status === 'error') {
        setIsLoading(false);
        setErrorMessage(t('powerDownError'));
        return;
      }

      const response = await apiClient.broadcastPowerDown(
        outcome.result.signedTx,
        username
      );

      if (!response.success) {
        setErrorMessage(response.error || t('powerDownError'));
        setIsLoading(false);
        return;
      }

      userActionRecord('withdraw_vesting', {
        username,
        amount: steemPowerFromVests(withdraw, globalProps),
      });

      finishSuccess();
    } catch (err) {
      console.error('Power down error:', err);
      setErrorMessage(String(err));
      setIsLoading(false);
    }
  };

  const notes: { key: string; text: string; tone?: 'warning' | 'error' }[] = [];

  if (account && globalProps) {
    const toWithdraw = getPowerDownToWithdrawVests(account);
    const withdrawn = getPowerDownWithdrawnVests(account);

    if (toWithdraw - withdrawn > 0) {
      notes.push({
        key: 'already_power_down',
        text: t('alreadyPowerDown', {
          amount: formatSp(toWithdraw),
          withdrawn: formatSp(withdrawn),
          liquidTicker: LIQUID_TICKER,
        }),
      });
    }

    const delegated = parseAssetAmount(account.delegated_vesting_shares);
    if (delegated !== 0) {
      notes.push({
        key: 'delegating',
        text: t('delegating', {
          amount: formatSp(delegated),
          liquidTicker: LIQUID_TICKER,
        }),
      });
    }

    if (notes.length === 0) {
      notes.push({
        key: 'per_week',
        text: t('perWeek', {
          amount: formatPowerDownWeeklySteem(newWithdrawVests, globalProps),
          liquidTicker: LIQUID_TICKER,
        }),
      });
    }

    if (isPowerDownReserveWarning(newWithdrawVests, maxVests, globalProps)) {
      notes.push({
        key: 'warning',
        tone: 'warning',
        text: t('reserveWarning', { amount: 5, vestingToken: VESTING_TOKEN }),
      });
    }
  }

  if (errorMessage) {
    notes.push({
      key: 'error',
      tone: 'error',
      text: t('error', { message: errorMessage }),
    });
  }

  const sliderPercent = maxVests > 0 ? (newWithdrawVests / maxVests) * 100 : 0;
  const displayAmount = manualEntry !== false ? manualEntry : formatSp(newWithdrawVests);

  const formInner = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="space-y-4">
        <div className="relative px-1 py-2">
          <div className="bg-muted relative h-2.5 rounded-full shadow-inner">
            <div
              className="bg-primary absolute left-0 top-0 h-full rounded-full"
              style={{ width: `${sliderPercent}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={maxVests || 0}
            step={0.000001}
            value={newWithdrawVests}
            onChange={(e) => handleSliderChange(parseFloat(e.target.value))}
            disabled={isLoading || isPending || globalPropsLoading || maxVests <= 0}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            aria-label={t('amount')}
          />
          <div
            className="border-border bg-background pointer-events-none absolute top-1/2 h-7 w-7 -translate-y-1/2 rounded-full border shadow-sm"
            style={{ left: `calc(${sliderPercent}% - 14px)` }}
          />
        </div>
        <p className="text-muted-foreground text-center text-sm tabular-nums">
          {formatSp(newWithdrawVests)} {LIQUID_TICKER}
        </p>
      </div>

      <p className="powerdown-amount text-sm">
        {t('amount')}
        <br />
        <span className="mt-2 inline-flex flex-wrap items-center gap-2">
          <input
            value={displayAmount}
            onChange={handleInputChange}
            autoCorrect="off"
            disabled={isLoading || isPending || globalPropsLoading}
            className="border-input bg-background h-10 w-[30%] min-w-[8rem] rounded-md border px-3 text-sm"
          />
          {LIQUID_TICKER}
        </span>
      </p>

      {notes.length > 0 && (
        <ul className="powerdown-notes list-none space-y-2.5 text-[80%] leading-relaxed">
          {notes.map((note) => (
            <li
              key={note.key}
              className={cn(
                note.tone === 'warning' && 'text-amber-700 dark:text-amber-400',
                note.tone === 'error' && 'text-destructive'
              )}
            >
              {note.text}
            </li>
          ))}
        </ul>
      )}

      <ModalFormActions className="pt-2" columns={1}>
        <Button
          type="submit"
          disabled={isLoading || isPending || globalPropsLoading || !globalProps || !account}
          className={modalFormActionButtonClassName}
        >
          {isLoading || isPending ? tCommon('loading') : t('powerDownButton')}
        </Button>
      </ModalFormActions>
    </form>
  );

  const reauthDialog = (
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
  );

  if (variant === 'dialog') {
    return (
      <div className="px-1 py-1">
        <h2 className="mb-4 text-lg font-semibold">{t('title')}</h2>
        {formInner}
        {reauthDialog}
        {signing.dialog}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-lg px-4">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">{tWallet('powerDown')}</CardTitle>
        </CardHeader>
        <CardContent>{formInner}</CardContent>
      </Card>
      {reauthDialog}
      {signing.dialog}
    </div>
  );
}
