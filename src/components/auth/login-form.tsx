'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '@/lib/store';
import { setCredentials } from '@/lib/store/slices/auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';

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
    <div className="rounded-lg bg-white p-8 shadow-lg dark:bg-gray-800">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="username"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t('username')}
          </label>
          <input
            type="text"
            id="username"
            name="username"
            value={formData.username}
            onChange={handleChange}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            placeholder="Enter your username"
            disabled={isLoading || isPending}
          />
        </div>

        <div>
          <label
            htmlFor="privateKey"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t('privateKey')}
          </label>
          <input
            type="password"
            id="privateKey"
            name="privateKey"
            value={formData.privateKey}
            onChange={handleChange}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            placeholder="Enter your private key"
            disabled={isLoading || isPending}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Your private key is stored locally and never sent to the server
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || isPending}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {isLoading || isPending ? tCommon('loading') : t('loginButton')}
        </button>
      </form>
    </div>
  );
}
