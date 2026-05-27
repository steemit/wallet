'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

type VoterRow = { voter: string; sp: number; proxy: string };

type ProposalVotersDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: number | null;
};

export function ProposalVotersDialog({ open, onOpenChange, proposalId }: ProposalVotersDialogProps) {
  const t = useTranslations('wallet.proposalsPage');
  const [loading, setLoading] = useState(false);
  const [voters, setVoters] = useState<VoterRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || proposalId === null) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    void fetch(`/api/query/proposals/votes?proposalId=${proposalId}`)
      .then((r) => r.json() as Promise<{ success?: boolean; voters?: VoterRow[]; error?: string }>)
      .then((res) => {
        if (cancelled) return;
        if (!res.success || !Array.isArray(res.voters)) {
          setError(res.error ?? t('votersLoadFailed'));
          setVoters([]);
          return;
        }
        setVoters(res.voters);
      })
      .catch(() => {
        if (!cancelled) setError(t('votersLoadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, proposalId, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {proposalId !== null ? t('votersTitle', { id: proposalId }) : t('votersTitleGeneric')}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : voters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('votersEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t('votersAccount')}</th>
                  <th className="py-2 font-medium">{t('votersSp')}</th>
                </tr>
              </thead>
              <tbody>
                {voters.map((row) => (
                  <tr key={row.voter} className="border-b border-border/60">
                    <td className="py-2 pr-4">
                      <Link href={`/@${row.voter}`} className="hover:underline">
                        @{row.voter}
                      </Link>
                      {row.proxy ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({t('votersProxy', { proxy: row.proxy })})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 tabular-nums">{row.sp.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
