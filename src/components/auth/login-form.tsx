'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '@/lib/store';
import { setCredentials } from '@/lib/store/slices/auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LoginFormData {
  username: string;
  password: string;
}

export function LoginForm() {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const dispatch = useDispatch<AppDispatch>();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [formData, setFormData] = useState<LoginFormData>(() => {
    try {
      const saved = localStorage.getItem('wallet:rememberedUsername') ?? '';
      return { username: saved, password: '' };
    } catch {
      return { username: '', password: '' };
    }
  });
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [rememberUsername, setRememberUsername] = useState(() => {
    try {
      return !!localStorage.getItem('wallet:rememberedUsername');
    } catch {
      return false;
    }
  });

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
      const username = formData.username.trim().toLowerCase().replace(/^@+/, '');
      const rawSecret = formData.password.trim();

      if (!username || !rawSecret) {
        setError(t('requiredFields'));
        setIsLoading(false);
        return;
      }

      // Role-specific private keys we will store in Redux
      let ownerKey: string | null = null;
      let activeKey: string | null = null;
      let postingKey: string | null = null;
      let memoKey: string | null = null;

      // Accept either a WIF private key or a master password.
      let primaryPrivateKey: string | null = null;

      if (SteemSigner.isValidPrivateKey(rawSecret)) {
        // Single WIF path: we can't be certain of the role here,
        // so treat it as the primary key and do not guess roles.
        primaryPrivateKey = rawSecret;
      } else {
        // Master password path: derive all four role keys using steem-js helper
        try {
          const keys = SteemSigner.getPrivateKeysFromMasterPassword(username, rawSecret);
          ownerKey = keys.owner ?? null;
          activeKey = keys.active ?? null;
          postingKey = keys.posting ?? null;
          memoKey = keys.memo ?? null;
        } catch {
          setError(t('invalidSecret'));
          setIsLoading(false);
          return;
        }

        // Prefer active key as primary, fall back to owner/posting/memo
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

      // Store credentials in Redux (memory only)
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
        if (rememberUsername) {
          localStorage.setItem('wallet:rememberedUsername', username);
        } else {
          localStorage.removeItem('wallet:rememberedUsername');
        }
      } catch {
        // ignore
      }

      // Navigate to user's wallet (transfers tab), preserving legacy-style @username in URL
      startTransition(() => {
        const encoded = encodeURIComponent(`@${username}`);
        router.push(`/${encoded}/transfers`);
      });
    } catch (err) {
      console.error('Login error:', err);
      setError(tCommon('error'));
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md">
      {/* Login Form Card */}
      <div className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <h2 className="mb-8 text-center text-3xl font-bold tracking-tight text-foreground">
          {t('login')}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Username Input with @ prefix */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="username" className="text-sm font-semibold text-foreground">
              {t('username')}
            </Label>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground pointer-events-none">
                @
              </span>
              <Input
                id="username"
                name="username"
                type="text"
                value={formData.username}
                onChange={handleChange}
                required
                placeholder={t('usernamePlaceholder')}
                disabled={isLoading || isPending}
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

          {/* Save Login Option */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="keepLoggedIn"
              checked={rememberUsername}
              onCheckedChange={(value) => setRememberUsername(value === true)}
              disabled={isLoading || isPending}
              className="peer mt-0.5 border-muted-foreground/50 data-[state=unchecked]:bg-background"
            />
            <Label
              htmlFor="keepLoggedIn"
              className="cursor-pointer text-sm font-normal leading-snug text-muted-foreground peer-disabled:cursor-not-allowed"
            >
              {t('rememberUsername')}
            </Label>
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <Button type="submit" disabled={isLoading || isPending} className="w-full" size="lg">
            {isLoading || isPending ? tCommon('loading') : t('loginButton')}
          </Button>
        </form>
      </div>
    </div>
  );
}
