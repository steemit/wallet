'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '@/lib/store';
import { setCredentials } from '@/lib/store/slices/auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { Button } from '@/components/ui/button';
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

  const [formData, setFormData] = useState<LoginFormData>({
    username: '',
    password: '',
  });
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

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
      const username = formData.username.trim().toLowerCase();
      const rawSecret = formData.password.trim();

      if (!username || !rawSecret) {
        setError('Username and password are required');
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
          setError('Invalid private key or master password');
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
          setError('Invalid private key or master password');
          setIsLoading(false);
          return;
        }
      }

      if (!primaryPrivateKey) {
        setError('Invalid credentials');
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
    <div className="Login row">
      <div className="column">
        <div className="LoginForm max-w-28rem mx-auto mt-4 mb-2">
          {/* Login Form Card */}
          <div className="bg-card text-card-foreground border border-border rounded-lg p-8 shadow-sm max-w-md mx-auto">
            <h2 className="text-2xl font-bold mb-6 text-center">{t('login')}</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Username Input with @ prefix */}
              <div className="space-y-2">
                <Label htmlFor="username">{t('username')}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-muted-foreground">@</span>
                  <Input
                    id="username"
                    name="username"
                    type="text"
                    value={formData.username}
                    onChange={handleChange}
                    required
                    placeholder="username"
                    disabled={isLoading || isPending}
                    className="pl-8"
                  />
                </div>
              </div>

              {/* Private Key Input */}
              <div className="space-y-2">
                <Label htmlFor="password">{t('privateKey')}</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  placeholder="Enter your private key or master password"
                  disabled={isLoading || isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Your secret is stored locally and never sent to the server
                </p>
              </div>

              {/* Save Login Option */}
              <div className="flex items-center gap-2">
                <input type="checkbox" id="keepLoggedIn" className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary" />
                <Label htmlFor="keepLoggedIn" className="font-normal cursor-pointer">{t('keepLoggedIn')}</Label>
              </div>

              {/* Error Message */}
              {error && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
                  <p className="text-sm text-destructive font-medium">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={isLoading || isPending}
                className="w-full"
                size="lg"
              >
                {isLoading || isPending ? tCommon('loading') : t('loginButton')}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
