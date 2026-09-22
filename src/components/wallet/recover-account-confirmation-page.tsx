'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { StaticPageShell } from '@/components/layout/static-page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient, SteemSigner } from '@/lib/steem/client';
import { ownerHistoryContainsKey } from '@/lib/steem/owner-history';
import { userActionRecord } from '@/lib/analytics/overseer';

// wallet-legacy enforced new-password strength via PasswordInput's
// validatePassword (src/app/components/elements/PasswordInput.jsx): a new
// password must be at least 32 characters ("password_must_be_characters_or_more",
// amount: 32; the same bound is used by KeyEdit.js). The recovery flow
// derives the new owner key from this password, so a short one weakens the
// recovered account's owner authority — reject it before any key derivation.
const NEW_PASSWORD_MIN_LENGTH = 32;

function passwordToOwnerPubKey(username: string, password: string): string {
  const raw = password.trim();
  if (SteemSigner.isValidPrivateKey(raw)) {
    return SteemSigner.privateKeyToPublicKey(raw);
  }
  const ownerWif = SteemSigner.derivePrivateKeyFromPassword(username, raw, 'owner');
  return SteemSigner.privateKeyToPublicKey(ownerWif);
}

/**
 * Map a verify error to localized copy via the machine-readable
 * record_status; fall back to the server message or the generic text.
 */
function verifyErrorText(
  t: (key: string) => string,
  recordStatus: string | undefined,
  serverError: string | undefined,
  fallback: string
): string {
  switch (recordStatus) {
    case 'open':
      return t('statusNotApproved');
    case 'processing':
      return t('statusInProgress');
    case 'expired':
      return t('statusExpired');
    case 'consumed':
      return t('statusAlreadyUsed');
    default:
      return serverError || fallback;
  }
}

export function RecoverAccountConfirmationPage({ code }: { code: string }) {
  const t = useTranslations('wallet.recoverAccountConfirmationPage');
  const tWallet = useTranslations('wallet');

  const [accountName, setAccountName] = useState<string | null>(null);
  // 'confirmed': full flow (confirm + broadcast). 'closed': confirm already
  // succeeded on-chain, only the final recover_account broadcast is pending —
  // re-running confirm would be rejected by its CAS, so this mode skips it.
  const [recordStatus, setRecordStatus] = useState<'confirmed' | 'closed' | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(true);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [oldPasswordError, setOldPasswordError] = useState<string | null>(null);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  // Verify code on mount
  useEffect(() => {
    let cancelled = false;
    apiClient
      .verifyRecoveryCode(code)
      .then((res) => {
        if (cancelled) return;
        if (
          res.status === 'ok' &&
          res.account_name &&
          (res.record_status === 'confirmed' || res.record_status === 'closed')
        ) {
          setAccountName(res.account_name);
          setRecordStatus(res.record_status);
        } else {
          setVerifyError(verifyErrorText(t, res.record_status, res.error, t('invalidCode')));
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
  }, [code, t]);

  const canSubmit =
    accountName &&
    oldPassword.trim().length > 0 &&
    newPassword.trim().length > 0 &&
    !oldPasswordError &&
    !newPasswordError &&
    !progress;

  /**
   * Sign recover_account locally and relay it through the server. Throws on
   * failure (signing error or non-success relay response) so callers can
   * surface the error instead of pretending the recovery completed.
   */
  const runBroadcast = async (name: string, oldPwd: string, newPwd: string): Promise<void> => {
    const { signedTx } = await SteemSigner.signRecoverAccount(name, oldPwd, newPwd);
    const broadcastRes = await apiClient.broadcastRecoverAccountTx(signedTx);
    if (!broadcastRes.success) {
      throw new Error(broadcastRes.error || t('broadcastFailedTitle'));
    }
  };

  const finishBroadcast = async (name: string, oldPwd: string, newPwd: string) => {
    try {
      await runBroadcast(name, oldPwd, newPwd);
      setBroadcastError(null);
      setSuccess(true);
      userActionRecord('recovery_account', { username: name });
    } catch (err) {
      // Confirm already succeeded (request_account_recovery is on-chain) but
      // the final recover_account did NOT land — the owner authority is still
      // with the attacker. Show a visible failure with a working retry path;
      // never report success here.
      if (process.env.NODE_ENV !== 'production') {
        console.warn('recover_account broadcast failed:', err);
      }
      setBroadcastError(err instanceof Error ? err.message : t('broadcastFailedTitle'));
      userActionRecord('recovery_account', { username: name, status: 'broadcast_failed' });
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accountName) return;

    const name = accountName;
    const oldPwd = oldPassword.trim();
    const newPwd = newPassword.trim();

    setSubmitError(null);
    setBroadcastError(null);

    // Block weak new passwords BEFORE any derivation or server calls
    // (legacy PasswordInput rule: >= 32 characters).
    if (newPwd.length < NEW_PASSWORD_MIN_LENGTH) {
      setNewPasswordError(t('newPasswordTooShort', { amount: NEW_PASSWORD_MIN_LENGTH }));
      return;
    }

    setProgress(t('checkingOwner'));

    try {
      // Verify old owner key is in recent owner history — against the FULL
      // key set of every previous owner authority (same semantics as the
      // relay server), so multi-key owner accounts are not wrongly rejected.
      const oldOwnerPub = passwordToOwnerPubKey(name, oldPwd);
      const ownerHistoryRes = await apiClient.getOwnerHistory(name);
      const history = ownerHistoryRes.history ?? [];
      const oldOwnerMatch = ownerHistoryContainsKey(history, oldOwnerPub);

      if (!oldOwnerMatch) {
        setOldPasswordError(t('oldPasswordNotInHistory'));
        return;
      }

      // Retry mode (record already closed): skip confirm — its CAS only
      // accepts status='confirmed' and the on-chain request_account_recovery
      // has already been submitted. Go straight to the final broadcast.
      if (recordStatus !== 'closed') {
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
          // Machine-readable record_status (e.g. 'expired', 'processing')
          // maps to the same localized copy the verify states use.
          setSubmitError(
            res.record_status === 'expired'
              ? t('statusExpired')
              : res.record_status === 'processing'
                ? t('statusInProgress')
                : res.error || t('unknownError')
          );
          return;
        }

        // The record is now closed on the server; any retry of the final
        // broadcast must not run confirm again.
        setRecordStatus('closed');
      }

      await finishBroadcast(name, oldPwd, newPwd);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setProgress(null);
    }
  };

  const onRetryBroadcast = async () => {
    if (!accountName || progress) return;
    setBroadcastError(null);
    setProgress(t('broadcastingRecovery'));
    await finishBroadcast(accountName, oldPassword.trim(), newPassword.trim());
    setProgress(null);
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

  // Error state: code invalid or not actionable
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
            href={`/login?account=${encodeURIComponent(accountName)}&msg=accountrecovered`}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('goToLogin')}
          </a>
        </div>
      </StaticPageShell>
    );
  }

  // Broadcast-failure state: confirm succeeded on-chain but recover_account
  // did not land. The account is NOT recovered — offer a working retry (the
  // form values are still in state; the same link also re-enters retry mode
  // on a fresh visit because the record stays 'closed').
  if (broadcastError) {
    return (
      <StaticPageShell title={tWallet('navStolenAccountRecovery')}>
        <div className="max-w-2xl space-y-4">
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive space-y-2"
            role="alert"
          >
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" aria-hidden />
              {t('broadcastFailedTitle')}
            </div>
            <p>{t('broadcastFailedBody')}</p>
            <p className="text-xs">{broadcastError}</p>
          </div>
          {progress ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {progress}
            </div>
          ) : (
            <Button type="button" onClick={onRetryBroadcast}>
              {t('retryBroadcast')}
            </Button>
          )}
        </div>
      </StaticPageShell>
    );
  }

  // Main form ('confirmed' = full flow; 'closed' = finish-the-broadcast retry)
  return (
    <StaticPageShell title={tWallet('navStolenAccountRecovery')}>
      <div className="max-w-2xl space-y-6">
        <p className="text-muted-foreground text-sm leading-relaxed">
          {recordStatus === 'closed' ? t('retryModeIntro') : t('intro')}
        </p>

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
                const v = e.target.value;
                setNewPassword(v);
                // Live strength feedback (legacy PasswordInput behavior):
                // only flag a partially typed password, never an empty one.
                const trimmed = v.trim();
                setNewPasswordError(
                  trimmed.length > 0 && trimmed.length < NEW_PASSWORD_MIN_LENGTH
                    ? t('newPasswordTooShort', { amount: NEW_PASSWORD_MIN_LENGTH })
                    : null
                );
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
