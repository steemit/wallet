'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { StaticPageShell } from '@/components/layout/static-page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient, SteemSigner } from '@/lib/steem/client';

const emailRegex =
  /^([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x22([^\x0d\x22\x5c\x80-\xff]|\x5c[\x00-\x7f])*\x22)(\x2e([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x22([^\x0d\x22\x5c\x80-\xff]|\x5c[\x00-\x7f])*\x22))*\x40([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x5b([^\x0d\x5b-\x5d\x80-\xff]|\x5c[\x00-\x7f])*\x5d)(\x2e([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x5b([^\x0d\x5b-\x5d\x80-\xff]|\x5c[\x00-\x7f])*\x5d))*$/;

const JULY_14_HACK_MS = Date.UTC(2016, 6, 14, 0, 0, 0, 0);

function parseSteemDateMs(raw: string | undefined): number | null {
  if (!raw) return null;
  const iso = raw.endsWith('Z') ? raw : `${raw}Z`;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function passwordToOwnerPubKey(username: string, passwordOrKey: string): string {
  const raw = passwordOrKey.trim();
  if (SteemSigner.isValidPrivateKey(raw)) {
    return SteemSigner.privateKeyToPublicKey(raw);
  }
  const ownerWif = SteemSigner.derivePrivateKeyFromPassword(username, raw, 'owner');
  return SteemSigner.privateKeyToPublicKey(ownerWif);
}

export function RecoverAccountStep1Page() {
  const t = useTranslations('wallet.recoverAccountStep1Page');
  const tWallet = useTranslations('wallet');

  const [accountName, setAccountName] = useState('');
  const [accountError, setAccountError] = useState<string | null>(null);
  const [recentPassword, setRecentPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [step, setStep] = useState<'verify' | 'email' | 'done'>('verify');

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);

  const normalizedName = accountName.trim().toLowerCase();

  const derivedOwnerPub = useMemo(() => {
    if (!normalizedName || !recentPassword.trim()) return null;
    try {
      return passwordToOwnerPubKey(normalizedName, recentPassword);
    } catch {
      return null;
    }
  }, [normalizedName, recentPassword]);

  const canBegin =
    normalizedName.length > 0 &&
    recentPassword.trim().length > 0 &&
    !accountError &&
    !passwordError &&
    !progress;

  const canSubmitEmail =
    step === 'email' &&
    email.trim().length > 0 &&
    !emailError &&
    !progress;

  const validateAccount = async (name: string) => {
    setAccountError(null);
    if (!name) return;
    const res = await apiClient.getAccounts([name], { fresh: true });
    const account = res.accounts?.[0];
    if (!account) {
      setAccountError(t('accountNotFound'));
      return;
    }

    const lastOwnerUpdateMs = parseSteemDateMs(
      (account as { last_owner_update?: string }).last_owner_update
    );
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    if (
      lastOwnerUpdateMs !== null &&
      lastOwnerUpdateMs < Math.max(thirtyDaysAgo, JULY_14_HACK_MS)
    ) {
      setAccountError(t('unableToRecoverNotChangedRecently'));
    }
  };

  const validateOwnerWasUsedRecently = async (name: string, passwordOrKey: string) => {
    const pub = passwordToOwnerPubKey(name, passwordOrKey);
    const ownerHistoryRes = await apiClient.getOwnerHistory(name);
    const history = (ownerHistoryRes.history ?? []) as {
      previous_owner_authority?: { key_auths?: [string, number][] };
    }[];
    return history.some((row) => row.previous_owner_authority?.key_auths?.[0]?.[0] === pub);
  };

  const onBeginRecovery = async (e: FormEvent) => {
    e.preventDefault();
    const name = normalizedName;
    const pwd = recentPassword.trim();
    if (!name || !pwd) return;

    setPasswordError(null);
    setProgress(t('checkingOwner'));
    try {
      const ok = await validateOwnerWasUsedRecently(name, pwd);
      if (!ok) {
        setPasswordError(t('passwordNotUsedInLastDays'));
        return;
      }
      setStep('email');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('unknownError');
      setPasswordError(message);
    } finally {
      setProgress(null);
    }
  };

  const onSubmitEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!derivedOwnerPub) return;
    setProgress(t('submittingRequest'));
    try {
      const res = await apiClient.initiateAccountRecoveryWithEmail({
        contact_email: email.trim().toLowerCase(),
        account_name: normalizedName,
        owner_key: derivedOwnerPub,
      });
      if (res.status === 'duplicate') {
        setEmailError(t('requestAlreadySubmitted'));
        return;
      }
      if (res.status !== 'ok') {
        setEmailError(res.error || t('unknownError'));
        return;
      }
      setStep('done');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('unknownError');
      setEmailError(message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <StaticPageShell title={tWallet('navStolenAccountRecovery')}>
      <div className="max-w-2xl space-y-6">
        <p className="text-muted-foreground text-sm leading-relaxed">{t('intro')}</p>

        {step === 'verify' && (
          <form className="space-y-5" onSubmit={onBeginRecovery} noValidate>
            <div className="space-y-2">
              <Label htmlFor="recover-account-name">{t('accountName')}</Label>
              <Input
                id="recover-account-name"
                value={accountName}
                onChange={(e) => {
                  setAccountName(e.target.value);
                  setAccountError(null);
                }}
                onBlur={() => void validateAccount(normalizedName)}
                autoComplete="off"
                disabled={!!progress}
              />
              {accountError && (
                <p className="text-destructive text-sm" role="alert">
                  {accountError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="recover-recent-password">{t('recentPassword')}</Label>
              <Input
                id="recover-recent-password"
                type="password"
                value={recentPassword}
                onChange={(e) => {
                  setRecentPassword(e.target.value);
                  setPasswordError(null);
                }}
                autoComplete="off"
                disabled={!!progress}
              />
              {passwordError && (
                <p className="text-destructive text-sm" role="alert">
                  {passwordError}
                </p>
              )}
            </div>

            {progress && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {progress}
              </div>
            )}

            <Button type="submit" disabled={!canBegin}>
              {t('beginRecovery')}
            </Button>
          </form>
        )}

        {step === 'email' && (
          <form className="space-y-5" onSubmit={onSubmitEmail} noValidate>
            <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
              <p className="text-muted-foreground">{t('enterEmailToVerify')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="recover-email">{t('email')}</Label>
              <Input
                id="recover-email"
                type="email"
                value={email}
                onChange={(e) => {
                  const v = e.target.value;
                  setEmail(v);
                  if (!v.trim()) setEmailError(null);
                  else if (!emailRegex.test(v.trim().toLowerCase())) setEmailError(t('emailNotValid'));
                  else setEmailError(null);
                }}
                disabled={!!progress}
                autoComplete="off"
              />
              {emailError && (
                <p className="text-destructive text-sm" role="alert">
                  {emailError}
                </p>
              )}
            </div>

            {progress && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {progress}
              </div>
            )}

            <Button type="submit" variant="outline" disabled={!canSubmitEmail}>
              {t('continueWithEmail')}
            </Button>
          </form>
        )}

        {step === 'done' && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-900 dark:text-emerald-100">
            {t('thanksForSubmitting')}
          </div>
        )}
      </div>
    </StaticPageShell>
  );
}

