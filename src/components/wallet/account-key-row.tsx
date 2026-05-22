'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import QRCode from 'react-qr-code';
import { QrCode } from 'lucide-react';
import {
  type AccountAuthType,
  type AuthRoleKeys,
  wifForPublicKey,
} from '@/lib/wallet/account-keys';
import { LoginForm } from '@/components/auth/login-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface AccountKeyRowProps {
  pubkey: string;
  authType: AccountAuthType;
  accountName: string;
  roleKeys: AuthRoleKeys;
  /** i18n key under wallet.permissions for private key title */
  privateTitleKey: string;
  onWifVisibleChange?: (visible: boolean) => void;
}

export function AccountKeyRow({
  pubkey,
  authType,
  accountName,
  roleKeys,
  privateTitleKey,
  onWifVisibleChange,
}: AccountKeyRowProps) {
  const t = useTranslations('wallet.permissions');
  const tAuth = useTranslations('auth');
  const [loginOpen, setLoginOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const wif = useMemo(() => wifForPublicKey(pubkey, roleKeys), [pubkey, roleKeys]);

  useEffect(() => {
    onWifVisibleChange?.(!!wif);
  }, [wif, onWifVisibleChange]);

  const authTypeLabel = useMemo(() => {
    const map: Record<AccountAuthType, string> = {
      posting: t('authTypePosting'),
      active: t('authTypeActive'),
      owner: t('authTypeOwner'),
      memo: t('authTypeMemo'),
    };
    return map[authType];
  }, [authType, t]);

  const qrText = wif ?? pubkey;
  const qrIsPrivate = !!wif;

  const handleLoginSuccess = useCallback(() => {
    setLoginOpen(false);
  }, []);

  return (
    <div className="ShowKey space-y-4 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div>
        <h5 className="text-sm font-semibold text-foreground">
          {t('publicKeyTitle', { type: authTypeLabel })}
        </h5>
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label={t('showQr')}
                onClick={() => setQrOpen(true)}
              >
                <QrCode className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('showQr')}</TooltipContent>
          </Tooltip>
          <code className="text-muted-foreground min-w-0 flex-1 break-all text-xs leading-relaxed">
            {pubkey}
          </code>
        </div>
      </div>

      <div>
        <h5 className="text-sm font-semibold text-foreground">{t(privateTitleKey)}</h5>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <Input
            readOnly
            value={wif ?? '•'.repeat(44)}
            className="font-mono text-xs sm:flex-1"
            aria-label={t('privateKeyMasked')}
          />
          <div className="flex shrink-0 items-center gap-2">
            {wif ? (
              <div className="rounded-md border border-border bg-background p-2">
                <QRCode value={wif} size={64} />
              </div>
            ) : (
              <Button type="button" variant="secondary" onClick={() => setLoginOpen(true)}>
                {t('reveal')}
              </Button>
            )}
          </div>
        </div>
      </div>

      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tAuth('login')}</DialogTitle>
            <DialogDescription>{t('revealLoginHint')}</DialogDescription>
          </DialogHeader>
          <LoginForm
            embedded
            fixedUsername={accountName}
            onLoginSuccess={handleLoginSuccess}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {qrIsPrivate
                ? t('qrPrivateTitle', { type: authTypeLabel })
                : t('qrPublicTitle', { type: authTypeLabel })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-center rounded-md border border-border bg-white p-4">
            <QRCode value={qrText} size={180} />
          </div>
          <code className="text-muted-foreground block break-all text-center text-xs">{qrText}</code>
        </DialogContent>
      </Dialog>
    </div>
  );
}
