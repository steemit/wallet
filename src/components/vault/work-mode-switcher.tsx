'use client';

// Work mode switcher (A5) — the PrivateKey / Vault dual selector shown at the
// top of the Work Mode drawer.
//
// - The mode is a DEVICE PREFERENCE: it is read from and written to the vault
//   registry's settings row and does not depend on the login state — the
//   switcher renders and works signed-out.
// - PrivateKey Mode carries a Legacy/Deprecated annotation: the encrypted
//   vault is the future direction (blueprint), the legacy session-key path is
//   on its way out (removed in phase C).
// - A successful switch updates the UI in place (useSigningMode contract) —
//   the page never reloads. A failed switch keeps the previous selection and
//   surfaces the mapped error below the control.
//
// This component never touches key material; it only moves mode strings
// through the SigningFacade.
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';

import { useSigningMode } from '@/hooks/use-signing-mode';
import { VaultError } from '@/lib/vault/errors';
import type { SigningFacade, SigningMode } from '@/lib/vault/types';
import { cn } from '@/lib/utils';

export interface WorkModeSwitcherProps {
  /** The app's signing facade (from the vault runtime); null when storage is unavailable. */
  facade: SigningFacade | null;
  /** Notified on every mode transition — the initial load and each successful switch. */
  onModeChange?: (mode: SigningMode) => void;
  /** id of the focusable container (the B-phase dapp hook focuses it — see app-layout.tsx). */
  focusId?: string | undefined;
}

interface ModeOption {
  value: SigningMode;
  titleKey: string;
  badgeKey?: string;
  descriptionKey: string;
  icon: typeof KeyRound;
}

export function WorkModeSwitcher({ facade, onModeChange, focusId }: WorkModeSwitcherProps) {
  const t = useTranslations('vault');
  const { mode, loading, switching, loadFailed, retryLoad, setMode } = useSigningMode(facade);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // Report every mode transition — the initial load and each successful
  // switch. Parents pass stable callbacks (state setters), so the dependency
  // on onModeChange is safe; the call is idempotent for parents using
  // setState-style handlers.
  useEffect(() => {
    if (mode !== null) {
      onModeChange?.(mode);
    }
  }, [mode, onModeChange]);

  const select = async (next: SigningMode) => {
    if (switching || mode === next) return;
    setErrorKey(null);
    try {
      await setMode(next);
    } catch (error) {
      // The hook keeps displaying the previous mode; surface the mapped code.
      if (error instanceof VaultError) {
        setErrorKey(`errors.${error.code}`);
      } else {
        console.error('Failed to switch the signing mode', error);
        setErrorKey('errors.unexpected');
      }
    }
  };

  const options: ModeOption[] = [
    {
      value: 'privateKey',
      titleKey: 'modePrivateKeyTitle',
      badgeKey: 'modePrivateKeyBadge',
      descriptionKey: 'modePrivateKeyDescription',
      icon: KeyRound,
    },
    {
      value: 'vault',
      titleKey: 'modeVaultTitle',
      descriptionKey: 'modeVaultDescription',
      icon: ShieldCheck,
    },
  ];

  return (
    <section
      id={focusId}
      tabIndex={-1}
      aria-label={t('workModeTitle')}
      className="focus-visible:outline-none"
    >
      <p className="text-muted-foreground px-1 text-sm">{t('workModeIntro')}</p>
      <div
        role="radiogroup"
        aria-label={t('workModeTitle')}
        aria-busy={switching || loading}
        className="mt-2 grid grid-cols-2 gap-2"
      >
        {options.map(({ value, titleKey, badgeKey, descriptionKey, icon: Icon }) => {
          const selected = mode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={switching || loading || !facade}
              onClick={() => void select(value)}
              className={cn(
                'flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors',
                'hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border',
              )}
              data-mode={value}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {t(titleKey)}
                </span>
                {badgeKey && (
                  <span className="bg-muted text-muted-foreground rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                    {t(badgeKey)}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground text-xs leading-snug">
                {t(descriptionKey)}
              </span>
            </button>
          );
        })}
      </div>

      {switching && (
        <p className="text-muted-foreground mt-2 flex items-center gap-1.5 px-1 text-xs">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {t('switching')}
        </p>
      )}
      {errorKey && (
        <p className="text-destructive mt-2 px-1 text-xs font-medium" role="alert">
          {t(errorKey)}
        </p>
      )}
      {loadFailed && (
        <div className="mt-2 flex items-center justify-between gap-2 px-1">
          <span className="text-destructive text-xs" role="alert">
            {t('modeLoadFailed')}
          </span>
          <button
            type="button"
            onClick={retryLoad}
            disabled={!facade}
            className="text-primary text-xs font-medium underline underline-offset-2 disabled:opacity-50"
          >
            {t('retry')}
          </button>
        </div>
      )}
    </section>
  );
}
