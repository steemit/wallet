'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '@/lib/store';
import { setCredentials } from '@/lib/store/slices/auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import {
  normalizeSteemUsername,
  REMEMBERED_POSTING_KEY_KEY,
  REMEMBERED_USERNAME_KEY,
} from '@/lib/auth/browser-storage';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { transfersPathForUsername } from '@/lib/wallet/wallet-modal-search-params';

interface LoginFormData {
  username: string;
  password: string;
}

export interface LoginFormProps {
  /**
   * Dialog / in-page modal: compact layout and `onLoginSuccess` instead of redirect.
   * Feature set matches the login page unless `fixedUsername` locks the account field.
   */
  embedded?: boolean;
  /** Lock username to this account (normalized). */
  fixedUsername?: string;
  onLoginSuccess?: () => void;
  /** Show “remember user on this device” (default: true when username is editable). */
  showRememberUser?: boolean;
}

export function LoginForm(props: LoginFormProps = {}) {
  const { embedded = false, fixedUsername, onLoginSuccess, showRememberUser: showRememberUserProp } =
    props;
  const showRememberUser = showRememberUserProp ?? !fixedUsername;
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const dispatch = useDispatch<AppDispatch>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const accountFromQuery =
    !embedded && !fixedUsername ? searchParams.get('account') : null;

  const [formData, setFormData] = useState<LoginFormData>(() => ({
    username: fixedUsername
      ? normalizeSteemUsername(fixedUsername)
      : accountFromQuery
        ? normalizeSteemUsername(accountFromQuery)
        : '',
    password: '',
  }));
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [rememberUser, setRememberUser] = useState(false);

  const passwordUpdatedNotice = useMemo(() => {
    if (searchParams.get('msg') !== 'passwordupdated') return null;
    const displayName = accountFromQuery
      ? normalizeSteemUsername(accountFromQuery)
      : formData.username;
    if (!displayName) return null;
    return t('passwordUpdateSuccess', { username: displayName });
  }, [accountFromQuery, formData.username, t]);

  useEffect(() => {
    if (!showRememberUser || fixedUsername || accountFromQuery) return;
    const id = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? '';
        if (saved) {
          setFormData((prev) => ({ ...prev, username: normalizeSteemUsername(saved) }));
          setRememberUser(true);
        }
      } catch {
        // ignore
      }
    });
    return () => cancelAnimationFrame(id);
  }, [showRememberUser, fixedUsername, accountFromQuery]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const username = fixedUsername
        ? normalizeSteemUsername(fixedUsername)
        : normalizeSteemUsername(formData.username);
      const rawSecret = formData.password.trim();

      if (!username || !rawSecret) {
        setError(t('requiredFields'));
        setIsLoading(false);
        return;
      }

      const accountsResp = await apiClient.getAccounts([username], { fresh: true });
      const account = accountsResp.accounts?.[0];
      if (!account) {
        setError(t('invalidUsername'));
        setIsLoading(false);
        return;
      }

      const accountOwnerKey = account.owner?.key_auths?.[0]?.[0];
      const accountActiveKey = account.active?.key_auths?.[0]?.[0];
      const accountPostingKey = account.posting?.key_auths?.[0]?.[0];
      const accountMemoKey = account.memo_key;

      const matchesPub = (priv: string, expectedPub?: string | null) => {
        if (!expectedPub) return false;
        try {
          return SteemSigner.privateKeyToPublicKey(priv) === expectedPub;
        } catch {
          return false;
        }
      };

      let ownerKey: string | null = null;
      let activeKey: string | null = null;
      let postingKey: string | null = null;
      let memoKey: string | null = null;
      let primaryPrivateKey: string | null = null;

      if (SteemSigner.isValidPrivateKey(rawSecret)) {
        if (matchesPub(rawSecret, accountOwnerKey)) {
          ownerKey = rawSecret;
          primaryPrivateKey = ownerKey;
        } else if (matchesPub(rawSecret, accountActiveKey)) {
          activeKey = rawSecret;
          primaryPrivateKey = activeKey;
        } else if (matchesPub(rawSecret, accountPostingKey)) {
          postingKey = rawSecret;
          primaryPrivateKey = postingKey;
        } else if (matchesPub(rawSecret, accountMemoKey)) {
          memoKey = rawSecret;
          primaryPrivateKey = memoKey;
        } else {
          setError(t('invalidSecret'));
          setIsLoading(false);
          return;
        }
      } else {
        try {
          const derivedOwner = SteemSigner.derivePrivateKeyFromPassword(
            username,
            rawSecret,
            'owner'
          );
          const derivedActive = SteemSigner.derivePrivateKeyFromPassword(
            username,
            rawSecret,
            'active'
          );
          const derivedPosting = SteemSigner.derivePrivateKeyFromPassword(
            username,
            rawSecret,
            'posting'
          );
          const derivedMemo = SteemSigner.derivePrivateKeyFromPassword(
            username,
            rawSecret,
            'memo'
          );

          if (matchesPub(derivedOwner, accountOwnerKey)) ownerKey = derivedOwner;
          if (matchesPub(derivedActive, accountActiveKey)) activeKey = derivedActive;
          if (matchesPub(derivedPosting, accountPostingKey)) postingKey = derivedPosting;
          if (matchesPub(derivedMemo, accountMemoKey)) memoKey = derivedMemo;
        } catch {
          setError(t('invalidSecret'));
          setIsLoading(false);
          return;
        }

        if (activeKey) {
          primaryPrivateKey = activeKey;
        } else if (ownerKey) {
          primaryPrivateKey = ownerKey;
        } else if (postingKey) {
          primaryPrivateKey = postingKey;
        } else if (memoKey) {
          primaryPrivateKey = memoKey;
        } else {
          setError(t('invalidSecret'));
          setIsLoading(false);
          return;
        }
      }

      if (!primaryPrivateKey) {
        setError(t('loginError'));
        setIsLoading(false);
        return;
      }

      // Restore posting key from device storage when signing in with a key that is not posting
      // (e.g. active WIF) but a posting key was saved earlier for claim-reward signing.
      if (!postingKey && rememberUser && accountPostingKey) {
        try {
          const savedPosting = localStorage.getItem(REMEMBERED_POSTING_KEY_KEY);
          const savedUser = localStorage.getItem(REMEMBERED_USERNAME_KEY);
          if (
            savedPosting &&
            savedUser === username &&
            SteemSigner.verifyPrivateKey(savedPosting, accountPostingKey)
          ) {
            postingKey = savedPosting;
          }
        } catch {
          // ignore
        }
      }

      // Get public key from primary private key for login challenge
      const publicKey = SteemSigner.privateKeyToPublicKey(primaryPrivateKey);

      // Get challenge from server
      const { challenge } = await apiClient.getChallenge(username);

      // Sign the challenge
      const signedChallenge = SteemSigner.signChallenge(challenge, primaryPrivateKey);

      // Login to server
      const response = await apiClient.login(username, signedChallenge, publicKey);

      if (!response.success) {
        setError(response.error || t('loginError'));
        setIsLoading(false);
        return;
      }

      // Store credentials in Redux (session memory; posting key may also be saved locally when opted in below)
      dispatch(
        setCredentials({
          username,
          ownerKey,
          activeKey,
          postingKey,
          memoKey,
          // Keep a primary key field for backwards compatibility (prefer active)
          privateKey: primaryPrivateKey,
          publicKey,
        })
      );

      try {
        if (rememberUser) {
          localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
          if (postingKey) {
            localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, postingKey);
          } else {
            localStorage.removeItem(REMEMBERED_POSTING_KEY_KEY);
          }
        } else {
          localStorage.removeItem(REMEMBERED_USERNAME_KEY);
          localStorage.removeItem(REMEMBERED_POSTING_KEY_KEY);
        }
      } catch {
        // ignore
      }

      setIsLoading(false);
      if (embedded) {
        onLoginSuccess?.();
      } else {
        startTransition(() => {
          router.push(transfersPathForUsername(username));
        });
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error('Login error:', err);
      setError(tCommon('error'));
      setIsLoading(false);
    }
  };

  const usernameInputId = embedded ? 'wallet-reauth-username' : 'username';

  return (
    <div className={embedded ? 'w-full' : 'mx-auto w-full max-w-md'}>
      <div
        className={
          embedded
            ? ''
            : 'rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8'
        }
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {passwordUpdatedNotice && (
            <div
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4"
              role="status"
            >
              <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                {passwordUpdatedNotice}
              </p>
            </div>
          )}

          {/* Username Input with @ prefix */}
          <div className="flex flex-col gap-2">
            <Label htmlFor={usernameInputId} className="text-sm font-semibold text-foreground">
              {t('username')}
            </Label>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground pointer-events-none">
                @
              </span>
              <Input
                id={usernameInputId}
                name="username"
                type="text"
                value={formData.username}
                onChange={handleChange}
                required
                placeholder={t('usernamePlaceholder')}
                disabled={isLoading || isPending || !!fixedUsername}
                readOnly={!!fixedUsername}
                className="pl-8"
              />
            </div>
          </div>

          {/* Private Key Input */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="password" className="text-sm font-semibold text-foreground">
              {t('privateKey')}
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              required
              placeholder={t('secretPlaceholder')}
              disabled={isLoading || isPending}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('secretHelper')}
            </p>
          </div>

          {showRememberUser && (
            <div className="flex items-start gap-3">
              <Checkbox
                id={embedded ? 'dialog-keepLoggedIn' : 'keepLoggedIn'}
                checked={rememberUser}
                onCheckedChange={(value) => setRememberUser(value === true)}
                disabled={isLoading || isPending}
                className="peer mt-0.5 border-muted-foreground/50 data-[state=unchecked]:bg-background"
              />
              <Label
                htmlFor={embedded ? 'dialog-keepLoggedIn' : 'keepLoggedIn'}
                className="cursor-pointer text-sm font-normal leading-snug text-muted-foreground peer-disabled:cursor-not-allowed"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2">
                      {t('rememberUsername')}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-left">
                    {t('rememberUserTooltip')}
                  </TooltipContent>
                </Tooltip>
              </Label>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isLoading || isPending}
            className="h-11 w-full text-base"
            size="lg"
          >
            {isLoading || isPending ? tCommon('loading') : t('loginButton')}
          </Button>
        </form>
      </div>
    </div>
  );
}
