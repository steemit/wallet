'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useSessionSigning } from '@/hooks/use-session-signing';
import { apiClient } from '@/lib/steem/client';
import type { Operation } from '@/lib/steem/types';
import { userActionRecord } from '@/lib/analytics/overseer';

export interface CancelPowerDownHandlerProps {
  onSuccess: () => void;
  onCancel: () => void;
}

/** Immediately broadcasts cancel power down (0 VESTS), matching wallet-legacy menu behavior. */
export function CancelPowerDownHandler({ onSuccess, onCancel }: CancelPowerDownHandlerProps) {
  const t = useTranslations('powerDown');
  const tCommon = useTranslations('common');
  const username = useSelector((state: RootState) => state.auth.username);
  // Unified signing entry (A6-T3a): privateKey sessions sign through the
  // facade's legacy backend exactly as before; vault identity sessions get
  // the per-key password dialog. `signing.dialog` mounts it below.
  const signing = useSessionSigning();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !username) return;
    started.current = true;

    void (async () => {
      try {
        // Build the exact operation tuple SteemSigner.signPowerDown used to
        // build internally (cancel = withdraw 0 VESTS) — the signing itself
        // goes through the unified session signing entry (A6-T3a).
        const operations: Operation[] = [
          [
            'withdraw_vesting',
            {
              account: username,
              vesting_shares: '0.000000 VESTS',
            },
          ],
        ];

        // withdraw_vesting is an active-class operation. privateKey sessions
        // sign through the facade's legacy backend (active key, owner
        // fallback); vault sessions get the per-key password dialog.
        const outcome = await signing.sign({
          operations,
          accountName: username,
          role: 'active',
        });

        if (outcome.status === 'cancelled' || outcome.status === 'needsClassicReauth') {
          // A user abort (or a privateKey session that holds no
          // active/owner key) cannot proceed — dismiss the flow quietly, the
          // same silent exit this handler always had for a keyless session.
          onCancel();
          return;
        }
        if (outcome.status === 'error') {
          setError(t('cancelError'));
          return;
        }

        const response = await apiClient.broadcastPowerDown(
          outcome.result.signedTx,
          username
        );
        if (!response.success) {
          setError(response.error || t('cancelError'));
          return;
        }
        userActionRecord('cancel_withdraw_vesting', { username });
        onSuccess();
      } catch (err) {
        console.error('Cancel power down error:', err);
        setError(t('cancelError'));
      }
    })();
    // `started` makes the flow one-shot: later identity/prop changes may
    // re-run the effect but never fire a second broadcast.
  }, [username, signing, onSuccess, onCancel, t]);

  if (error) {
    return (
      <div className="px-1 py-4">
        <p className="text-destructive text-sm">{error}</p>
        <button
          type="button"
          className="text-muted-foreground mt-4 text-sm underline"
          onClick={onCancel}
        >
          {tCommon('cancel')}
        </button>
      </div>
    );
  }

  return (
    <div className="px-1 py-4">
      <p className="text-muted-foreground text-sm">{tCommon('loading')}</p>
      {/* Vault password dialog for vault identity sessions (A6-T3a). */}
      {signing.dialog}
    </div>
  );
}
