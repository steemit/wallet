'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '@/lib/store';
import { setCredentials } from '@/lib/store/slices/auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { LegacyButton, LegacyInputGroup } from '@/components/ui/legacy-components';

interface LoginFormData {
  username: string;
  privateKey: string;
}

export function LoginForm() {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const dispatch = useDispatch<AppDispatch>();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [formData, setFormData] = useState<LoginFormData>({
    username: '',
    privateKey: '',
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
      // Validate private key format
      if (!SteemSigner.isValidPrivateKey(formData.privateKey)) {
        setError('Invalid private key format');
        setIsLoading(false);
        return;
      }

      // Get public key from private key
      const publicKey = SteemSigner.privateKeyToPublicKey(formData.privateKey);

      // Get challenge from server
      const { challenge } = await apiClient.getChallenge(formData.username);

      // Sign the challenge
      const signedChallenge = SteemSigner.signChallenge(challenge, formData.privateKey);

      // Login to server
      const response = await apiClient.login(
        formData.username,
        signedChallenge,
        publicKey
      );

      if (!response.success) {
        setError(response.error || t('loginError'));
        setIsLoading(false);
        return;
      }

      // Store credentials in Redux (memory only)
      dispatch(
        setCredentials({
          username: formData.username,
          privateKey: formData.privateKey,
          publicKey,
        })
      );

      // Navigate to wallet
      startTransition(() => {
        router.push('/wallet');
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
          <div className="bg-module border border-themed rounded-legacy p-8 shadow-sm">
            <form onSubmit={handleSubmit} className="mt-6">
              {/* Username Input with @ prefix */}
              <div>
                <label
                  htmlFor="username"
                  className="mb-2 block text-sm font-medium text-foreground"
                >
                  {t('username')}
                </label>
                <LegacyInputGroup
                  id="username"
                  name="username"
                  type="text"
                  prefix="@"
                  value={formData.username}
                  onChange={handleChange}
                  required
                  placeholder="username"
                  disabled={isLoading || isPending}
                />
              </div>

              {/* Private Key Input */}
              <div>
                <label
                  htmlFor="privateKey"
                  className="mb-2 block text-sm font-medium text-foreground"
                >
                  {t('privateKey')}
                </label>
                <LegacyInputGroup
                  id="privateKey"
                  name="privateKey"
                  type="password"
                  value={formData.privateKey}
                  onChange={handleChange}
                  required
                  placeholder="Enter your private key"
                  disabled={isLoading || isPending}
                />
                <p className="mt-1 text-xs text-text-secondary">
                  Your private key is stored locally and never sent to the server
                </p>
              </div>

              {/* Save Login Option */}
              <div className="LoginForm__save-login mt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-teal focus:ring-teal" />
                  <span className="text-sm text-foreground">{t('keepLoggedIn')}</span>
                </label>
              </div>

              {/* Error Message */}
              {error && (
                <div className="rounded-legacy bg-steem-red/10 border border-steem-red/30 p-4 mt-4">
                  <p className="text-sm text-steem-red">{error}</p>
                </div>
              )}

              {/* Submit Button - Using Legacy Button */}
              <LegacyButton
                type="submit"
                disabled={isLoading || isPending}
                fullWidth
                variant="black"
              >
                {isLoading || isPending ? tCommon('loading') : t('loginButton')}
              </LegacyButton>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
