'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useSteemAccount } from '@/hooks/use-steem-account';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import {
  buildAccountUpdateForPasswordChange,
  generateNewMasterPassword,
  looksLikePublicKey,
  verifyCurrentPasswordMatchesAccount,
} from '@/lib/wallet/change-password';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export interface ChangePasswordSectionProps {
  username: string;
  isMyAccount: boolean;
}

export function ChangePasswordSection({ username, isMyAccount }: ChangePasswordSectionProps) {
  const t = useTranslations('wallet.changePasswordPage');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { logout } = useAuth();
  const { data: account, loading, error } = useSteemAccount(username);

  const [currentPassword, setCurrentPassword] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmCheck, setConfirmCheck] = useState(false);
  const [confirmSaved, setConfirmSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const currentPasswordError = useMemo(() => {
    if (!currentPassword.trim()) return null;
    if (looksLikePublicKey(currentPassword)) return t('needPasswordOrKey');
    return null;
  }, [currentPassword, t]);

  const confirmPasswordError = useMemo(() => {
    if (!confirmPassword.trim() || !generatedPassword) return null;
    if (confirmPassword.trim() !== generatedPassword) return t('passwordsDoNotMatch');
    return null;
  }, [confirmPassword, generatedPassword, t]);

  const canSubmit =
    isMyAccount &&
    !!account &&
    !!generatedPassword &&
    currentPassword.trim().length > 0 &&
    !currentPasswordError &&
    confirmPassword.trim() === generatedPassword &&
    confirmCheck &&
    confirmSaved &&
    !submitting;

  const handleGenerate = () => {
    setSubmitError(null);
    setGeneratedPassword(generateNewMasterPassword());
    setConfirmPassword('');
    setConfirmCheck(false);
    setConfirmSaved(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !account || !generatedPassword) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      if (!verifyCurrentPasswordMatchesAccount(account, currentPassword.trim())) {
        setSubmitError(t('incorrectPassword'));
        return;
      }

      const { operation, signingKey } = buildAccountUpdateForPasswordChange(
        account,
        currentPassword.trim(),
        generatedPassword
      );
      const signedTx = await SteemSigner.signAccountUpdate(operation, signingKey);
      const result = await apiClient.broadcastAccountUpdate(signedTx, username);

      if (!result.success) {
        const message =
          result.details || result.error || t('broadcastFailed');
        if (
          /missing owner authority/i.test(message) &&
          !/bad cast|bad_cast/i.test(message)
        ) {
          setSubmitError(t('missingOwnerAuthority'));
        } else {
          setSubmitError(message);
        }
        return;
      }

      await logout();
      router.push(`/login?account=${encodeURIComponent(username)}&msg=passwordupdated`);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('broadcastFailed');
      if (/missing owner authority/i.test(message)) {
        setSubmitError(t('missingOwnerAuthority'));
      } else if (/incorrect password/i.test(message)) {
        setSubmitError(t('incorrectPassword'));
      } else {
        setSubmitError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !account) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {error || t('loadError')}
      </p>
    );
  }

  if (!isMyAccount) {
    return (
      <div className="ChangePasswordPage max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">{t('viewOnly')}</p>
      </div>
    );
  }

  const showRecoverHint =
    submitError != null && /missing owner authority/i.test(submitError);

  return (
    <div className="ChangePasswordPage max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{t('resetIntro', { username })}</p>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm leading-relaxed">
        <hr className="border-border mb-4" />
        <ul className="text-muted-foreground space-y-1">
          {(['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6', 'rule7'] as const).map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        <hr className="border-border mt-4" />
      </div>

      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <Label htmlFor="change-password-account">{t('accountName')}</Label>
          <Input id="change-password-account" value={username} disabled readOnly autoComplete="off" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="change-password-current">{t('currentPassword')}</Label>
            <Link href="/recover_account_step_1" className="text-primary text-xs font-semibold hover:underline">
              {t('recoverPassword')}
            </Link>
          </div>
          <Input
            id="change-password-current"
            type="password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setSubmitError(null);
            }}
            disabled={submitting}
            autoComplete="current-password"
          />
          {currentPasswordError && (
            <p className="text-destructive text-sm" role="alert">
              {currentPasswordError}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>
            {t('generatedPassword')}{' '}
            <span className="text-muted-foreground font-normal">({t('newLabel')})</span>
          </Label>
          {generatedPassword ? (
            <div className="space-y-2">
              <code className="bg-background text-destructive block break-all rounded-md border border-border px-3 py-2 text-center text-sm">
                {generatedPassword}
              </code>
              <p className="text-muted-foreground text-xs">{t('backupHint')}</p>
            </div>
          ) : (
            <Button type="button" variant="outline" onClick={handleGenerate} disabled={submitting}>
              {t('generateButton')}
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="change-password-confirm">{t('reEnterPassword')}</Label>
          <Input
            id="change-password-confirm"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={submitting || !generatedPassword}
            autoComplete="new-password"
          />
          {confirmPasswordError && (
            <p className="text-destructive text-sm" role="alert">
              {confirmPasswordError}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={confirmCheck}
              onCheckedChange={(checked) => setConfirmCheck(checked === true)}
              disabled={submitting}
            />
            <span>{t('understandNoRecovery')}</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={confirmSaved}
              onCheckedChange={(checked) => setConfirmSaved(checked === true)}
              disabled={submitting}
            />
            <span>{t('savedConfirm')}</span>
          </label>
        </div>

        {submitting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {tCommon('loading')}
          </div>
        )}

        {submitError && (
          <div className="text-destructive text-sm" role="alert">
            {showRecoverHint ? (
              <>
                {t('wrongPasswordHint')}{' '}
                <Link href="/recover_account_step_1" className="font-semibold underline">
                  {t('recoverAccount')}
                </Link>
                ?
              </>
            ) : (
              submitError
            )}
          </div>
        )}

        <Button type="submit" disabled={!canSubmit}>
          {t('updatePassword')}
        </Button>
      </form>
    </div>
  );
}
