'use client';

import { useCallback, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { useAuth, useActiveSigningKey } from '@/hooks/use-auth';
import {
  canManageBalanceForPageUrl,
  normalizeSteemUsername,
} from '@/lib/auth/browser-storage';
import { LoginForm } from '@/components/auth/login-form';
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
  const activeSigningKey = useActiveSigningKey();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawUsername = params?.username as string | undefined;
  const accountUsername = rawUsername ? decodeURIComponent(rawUsername).replace(/^@/, '') : '';
  const isMyAccount = !!isAuthenticated && !!loggedInUser && loggedInUser === accountUsername;

  const canManageBalance = canManageBalanceForPageUrl({
    urlUsername: accountUsername,
    loggedInUser,
    isAuthenticated,
  });

  const sessionMatchesPage =
    !isAuthenticated ||
    (!!loggedInUser &&
      normalizeSteemUsername(loggedInUser) === normalizeSteemUsername(accountUsername));

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

  useEffect(() => {
    if (walletAction === null || !accountUsername) return;
    if (!canManageBalance) {
      clearWalletQuery();
    }
  }, [walletAction, accountUsername, canManageBalance, clearWalletQuery]);

  const needsWalletReauth =
    open &&
    canManageBalance &&
    accountUsername &&
    (!sessionMatchesPage || activeSigningKey === null);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {needsWalletReauth && (
          <>
            <DialogHeader>
              <DialogTitle>{t('reauthTitle')}</DialogTitle>
              <DialogDescription>{t('reauthDescription')}</DialogDescription>
            </DialogHeader>
            <LoginForm
              embedded
              fixedUsername={accountUsername}
              onLoginSuccess={() => {
                /* Redux updates; modal re-renders into the wallet form */
              }}
            />
          </>
        )}
        {!needsWalletReauth && walletAction === 'transfer' && (
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
        {!needsWalletReauth && walletAction === 'powerDown' && (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>Power down</DialogTitle>
            </DialogHeader>
            <PowerDownForm variant="dialog" onSuccess={handleSuccess} />
          </>
        )}
        {!needsWalletReauth && walletAction === 'delegate' && (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>Delegate vesting shares</DialogTitle>
            </DialogHeader>
            <DelegateForm variant="dialog" onSuccess={handleSuccess} onCancel={clearWalletQuery} />
          </>
        )}
        {!needsWalletReauth && walletAction === 'advanced' && (
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
        {!needsWalletReauth && walletAction === 'convert' && (
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
