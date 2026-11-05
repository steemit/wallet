'use client';

// Key backup confirmation dialog (A5) — shown after a vault is CREATED or
// IMPORTED. Its job is to make sure the user has actually saved the vault
// password / backup file before moving on (blueprint key points):
//
//   - Losing the vault password means the encrypted keys inside the vault can
//     never be decrypted again on this device — there is no recovery.
//   - The Steem blockchain itself is unaffected: the on-chain keys stay
//     exactly as they are, and keys can always be re-imported into a new
//     vault.
//
// "Continue" stays disabled until the acknowledgment checkbox is ticked. The
// body is a separate component mounted inside DialogContent (Radix unmounts
// closed content), so each open starts with an unticked checkbox without a
// reset effect.
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { modalFormActionButtonClassName } from '@/components/ui/modal-form-actions';

export type KeyConfirmationContext = 'created' | 'imported';

export interface KeyConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which flow just finished — only affects the success line. */
  context: KeyConfirmationContext;
  /** Name of the vault that was created / imported. */
  vaultName: string;
}

export function KeyConfirmationDialog({
  open,
  onOpenChange,
  context,
  vaultName,
}: KeyConfirmationDialogProps) {
  const t = useTranslations('vault');
  const summaryKey = context === 'created' ? 'keyConfirmCreatedBody' : 'keyConfirmImportedBody';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('keyConfirmTitle')}</DialogTitle>
          <DialogDescription>{t(summaryKey, { name: vaultName })}</DialogDescription>
        </DialogHeader>
        <KeyConfirmationBody onConfirm={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function KeyConfirmationBody({ onConfirm }: { onConfirm: () => void }) {
  const t = useTranslations('vault');
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
          <p className="text-destructive flex items-start gap-2 text-sm font-medium">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('keyConfirmWarningPasswordLoss')}
          </p>
        </div>
        <p className="text-muted-foreground text-sm">{t('keyConfirmWarningChainKeys')}</p>
        <p className="text-muted-foreground text-sm">{t('keyConfirmWarningPublicNotes')}</p>
        <div className="flex items-start gap-2">
          <Checkbox
            id="vault-key-confirmation-ack"
            checked={acknowledged}
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
            className="mt-0.5"
          />
          <Label htmlFor="vault-key-confirmation-ack" className="text-sm leading-snug font-normal">
            {t('keyConfirmAcknowledge')}
          </Label>
        </div>
      </div>
      <DialogFooter>
        <Button
          type="button"
          disabled={!acknowledged}
          onClick={onConfirm}
          className={modalFormActionButtonClassName}
          data-testid="vault-key-confirmation-continue"
        >
          {t('keyConfirmContinue')}
        </Button>
      </DialogFooter>
    </>
  );
}
