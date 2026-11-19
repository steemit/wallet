'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { LoginForm } from '@/components/auth/login-form';
import { Skeleton } from '@/components/ui/skeleton';
import { useVaultRuntime } from '@/components/vault/vault-manager';
import { useSigningMode } from '@/hooks/use-signing-mode';
import { getRememberedDeviceUsername } from '@/lib/auth/browser-storage';
import { transfersPathForUsername } from '@/lib/wallet/wallet-modal-search-params';

/**
 * Root path: redirect to /@rememberedUser/transfers when a username is stored locally;
 * otherwise show the login form.
 *
 * Vault Mode (R3): the Legacy remembered-username jump belongs to the
 * PrivateKey flow (remembered username + remembered posting key) and is
 * skipped entirely in Vault Mode — the login form (dispatched to vault
 * identity selection) renders instead, and the Legacy localStorage keys are
 * not even read. The jump therefore waits until the persisted signing mode is
 * known; a mode that cannot be read (vault storage unavailable / failed read)
 * keeps the historical PrivateKey behavior, the persisted default.
 */
export function HomeRedirectOrLogin() {
  const router = useRouter();
  const runtime = useVaultRuntime();
  const { mode, loadFailed } = useSigningMode(runtime.state === 'ready' ? runtime.facade : null);
  const [phase, setPhase] = useState<'checking' | 'login'>('checking');

  // Mode resolution: wait while the vault runtime or the mode read is in
  // flight. useSigningMode reports loadFailed for a null facade, so the
  // runtime's own 'loading' state must be excluded explicitly.
  const modeResolved =
    runtime.state === 'unavailable' ||
    (runtime.state === 'ready' && (mode !== null || loadFailed));
  const vaultMode = mode === 'vault';

  useEffect(() => {
    if (!modeResolved) return;
    if (!vaultMode) {
      const remembered = getRememberedDeviceUsername();
      if (remembered) {
        router.replace(transfersPathForUsername(remembered));
        return;
      }
    }
    const id = requestAnimationFrame(() => setPhase('login'));
    return () => cancelAnimationFrame(id);
  }, [router, modeResolved, vaultMode]);

  if (phase === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <LoginForm />
    </div>
  );
}
