'use client';

import { useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { useAuth } from '@/hooks/use-auth';
import {
  WALLET_ACTION_QUERY,
  WALLET_ASSET_QUERY,
  WALLET_QUERY_KEYS,
  WALLET_TYPE_QUERY,
  parseWalletModalAction,
  parseWalletAsset,
  parseWalletTransferType,
} from '@/lib/wallet/wallet-modal-search-params';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TransferForm } from '@/components/wallet/transfer-form';
import { PowerDownForm } from '@/components/wallet/power-down-form';
import { DelegateForm } from '@/components/wallet/delegate-form';
import { WithdrawRoutesForm } from '@/components/wallet/withdraw-routes-form';
import { ConvertSbdForm } from '@/components/wallet/convert-sbd-form';

export interface WalletTransfersModalsProps {
  onWalletDataChanged?: () => void;
}

export function WalletTransfersModals({ onWalletDataChanged }: WalletTransfersModalsProps) {
  const t = useTranslations('wallet');
  const params = useParams();
  const { username: loggedInUser, isAuthenticated } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawUsername = params?.username as string | undefined;
  const accountUsername = rawUsername ? decodeURIComponent(rawUsername).replace(/^@/, '') : '';
  const isMyAccount = !!isAuthenticated && !!loggedInUser && loggedInUser === accountUsername;

  const walletAction = parseWalletModalAction(searchParams.get(WALLET_ACTION_QUERY));
  const asset = parseWalletAsset(searchParams.get(WALLET_ASSET_QUERY));
  const transferType = parseWalletTransferType(searchParams.get(WALLET_TYPE_QUERY));

  const clearWalletQuery = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    WALLET_QUERY_KEYS.forEach((k) => next.delete(k));
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }, [pathname, router, searchParams]);

  const handleSuccess = useCallback(() => {
    onWalletDataChanged?.();
    clearWalletQuery();
  }, [onWalletDataChanged, clearWalletQuery]);

  const open = walletAction !== null;

  const handleOpenChange = (next: boolean) => {
    if (!next) clearWalletQuery();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {walletAction === 'transfer' && (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>Transfer</DialogTitle>
            </DialogHeader>
            <TransferForm
              key={`${asset ?? 'STEEM'}-${transferType ?? 'transfer'}`}
              variant="dialog"
              initialAsset={asset ?? 'STEEM'}
              initialTransferType={transferType ?? 'transfer'}
              onSuccess={handleSuccess}
              onCancel={clearWalletQuery}
            />
          </>
        )}
        {walletAction === 'powerDown' && (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>Power down</DialogTitle>
            </DialogHeader>
            <PowerDownForm variant="dialog" onSuccess={handleSuccess} />
          </>
        )}
        {walletAction === 'delegate' && (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>Delegate vesting shares</DialogTitle>
            </DialogHeader>
            <DelegateForm variant="dialog" onSuccess={handleSuccess} onCancel={clearWalletQuery} />
          </>
        )}
        {walletAction === 'advanced' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('withdrawRoutes.title')}</DialogTitle>
              <DialogDescription className="sr-only">
                {t('withdrawRoutes.dialogDescription')}
              </DialogDescription>
            </DialogHeader>
            <WithdrawRoutesForm
              variant="dialog"
              accountUsername={accountUsername}
              isMyAccount={isMyAccount}
              {...(onWalletDataChanged ? { onRoutesUpdated: onWalletDataChanged } : {})}
              onCancel={clearWalletQuery}
            />
          </>
        )}
        {walletAction === 'convert' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('convertSbd.title')}</DialogTitle>
              <DialogDescription className="sr-only">{t('convertSbd.dialogDescription')}</DialogDescription>
            </DialogHeader>
            <ConvertSbdForm
              variant="dialog"
              accountUsername={accountUsername}
              isMyAccount={isMyAccount}
              onSuccess={handleSuccess}
              onCancel={clearWalletQuery}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
