'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useActiveSigningKey } from '@/hooks/use-auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
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
  const signingKey = useActiveSigningKey();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !username || !signingKey) return;
    started.current = true;

    void (async () => {
      try {
        const signedTx = await SteemSigner.signPowerDown(username, '0.000000 VESTS', signingKey);
        const response = await apiClient.broadcastPowerDown(signedTx, username);
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
  }, [username, signingKey, onSuccess, t]);

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

  return <p className="text-muted-foreground px-1 py-4 text-sm">{tCommon('loading')}</p>;
}
