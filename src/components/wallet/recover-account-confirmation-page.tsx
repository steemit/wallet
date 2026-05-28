'use client';

import { FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { StaticPageShell } from '@/components/layout/static-page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient, SteemSigner } from '@/lib/steem/client';

function passwordToOwnerPubKey(username: string, password: string): string {
  const raw = password.trim();
  if (SteemSigner.isValidPrivateKey(raw)) {
    return SteemSigner.privateKeyToPublicKey(raw);
  }
  const ownerWif = SteemSigner.derivePrivateKeyFromPassword(username, raw, 'owner');
  return SteemSigner.privateKeyToPublicKey(ownerWif);
}

export function RecoverAccountConfirmationPage({ code }: { code: string }) {
  const t = useTranslations('wallet.recoverAccountConfirmationPage');
  const tWallet = useTranslations('wallet');

  const [accountName, setAccountName] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(true);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [oldPasswordError, setOldPasswordError] = useState<string | null>(null);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Verify code on mount
  useState(() => {
    let cancelled = false;
    apiClient
      .verifyRecoveryCode(code)
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'ok' && res.account_name) {
          setAccountName(res.account_name);
        } else {
          setVerifyError(res.error || t('invalidCode'));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setVerifyError(err instanceof Error ? err.message : t('unknownError'));
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });
    return () => { cancelled = true; };
  });

  const canSubmit =
    accountName &&
    oldPassword.trim().length > 0 &&
    newPassword.trim().length > 0 &&
    !oldPasswordError &&
    !newPasswordError &&
    !progress;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accountName) return;

    const name = accountName;
    const oldPwd = oldPassword.trim();
    const newPwd = newPassword.trim();

    setSubmitError(null);
    setProgress(t('checkingOwner'));

    try {
      // Verify old owner key is in recent owner history
      const oldOwnerPub = passwordToOwnerPubKey(name, oldPwd);
      const ownerHistoryRes = await apiClient.getOwnerHistory(name);
      const history = ownerHistoryRes.history ?? [];
      const oldOwnerMatch = history.some(
        (row) => row.previous_owner_authority?.key_auths?.[0]?.[0] === oldOwnerPub
      );

      if (!oldOwnerMatch) {
        setOldPasswordError(t('oldPasswordNotInHistory'));
        return;
      }

      setProgress(t('submittingRecovery'));

      // Derive new owner key
      const newOwnerPub = passwordToOwnerPubKey(name, newPwd);
      const newOwnerAuthority = {
        weight_threshold: 1,
        account_auths: [] as [string, number][],
        key_auths: [[newOwnerPub, 1]] as [string, number][],
      };

      // Call server confirm endpoint
      const res = await apiClient.confirmAccountRecovery({
        code,
        account_name: name,
        old_owner_key: oldOwnerPub,
        new_owner_key: newOwnerPub,
        new_owner_authority: newOwnerAuthority,
      });

      if (res.status !== 'ok') {
        setSubmitError(res.error || t('unknownError'));
        return;
      }

      // Sign recover_account operation client-side, then broadcast via server relay
      try {
        const { signedTx } = SteemSigner.signRecoverAccount(name, oldPwd, newPwd);
        const tx = await signedTx;
        const broadcastRes = await apiClient.broadcastRecoverAccountTx(tx);
        if (!broadcastRes.success) {
          console.warn('recover_account broadcast returned error:', broadcastRes.error);
        }
      } catch (broadcastErr) {
        // Server already recorded the recovery, but broadcast failed.
        // The user can retry broadcast later. Don't block the success UI.
        console.warn('Client-side recover_account broadcast failed:', broadcastErr);
      }

      setSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setProgress(null);
    }
  };

  // Loading state: verifying code
  if (verifying) {
    return (
      <StaticPageShell title={tWallet('navStolenAccountRecovery')}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t('verifying')}
        </div>
      </StaticPageShell>
    );
  }

  // Error state: code invalid
  if (verifyError || !accountName) {
    return (
      <StaticPageShell title={tWallet('navStolenAccountRecovery')}>
        <div className="max-w-2xl">
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {verifyError || t('invalidCode')}
          </div>
        </div>
      </StaticPageShell>
    );
  }

  // Success state
  if (success) {
    return (
      <StaticPageShell title={tWallet('navStolenAccountRecovery')}>
        <div className="max-w-2xl space-y-4">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-900 dark:text-emerald-100">
            {t('successMessage')}
          </div>
          <a
            href={`/login.html#account=${accountName}&msg=accountrecovered`}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('goToLogin')}
          </a>
        </div>
      </StaticPageShell>
    );
  }

  // Main form
  return (
    <StaticPageShell title={tWallet('navStolenAccountRecovery')}>
      <div className="max-w-2xl space-y-6">
        <p className="text-muted-foreground text-sm leading-relaxed">{t('intro')}</p>

        <form className="space-y-5" onSubmit={onSubmit} noValidate>
          <div className="space-y-2">
            <Label>{t('accountName')}</Label>
            <Input value={accountName} disabled readOnly />
          </div>

          <div className="space-y-2">
            <Label htmlFor="recovery-old-password">{t('oldPassword')}</Label>
            <Input
              id="recovery-old-password"
              type="password"
              value={oldPassword}
              onChange={(e) => {
                setOldPassword(e.target.value);
                setOldPasswordError(null);
              }}
              autoComplete="off"
              disabled={!!progress}
            />
            {oldPasswordError && (
              <p className="text-destructive text-sm" role="alert">
                {oldPasswordError}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="recovery-new-password">{t('newPassword')}</Label>
            <Input
              id="recovery-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setNewPasswordError(null);
              }}
              autoComplete="off"
              disabled={!!progress}
            />
            {newPasswordError && (
              <p className="text-destructive text-sm" role="alert">
                {newPasswordError}
              </p>
            )}
          </div>

          {submitError && (
            <p className="text-destructive text-sm" role="alert">
              {submitError}
            </p>
          )}

          {progress && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {progress}
            </div>
          )}

          <Button type="submit" disabled={!canSubmit}>
            {t('submit')}
          </Button>
        </form>
      </div>
    </StaticPageShell>
  );
}
