'use client';

// Empty-vault dialog (A5) — the three-option entry point shown when Vault
// Mode is active but the device has no vault yet: create a new vault, import
// a backup, or keep browsing (close). "Continue browsing" simply closes —
// Vault Mode stays selected; the empty state remains reachable through the
// inline panel actions.
import { useTranslations } from 'next-intl';
import { FolderPlus, Upload } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { modalFormActionButtonClassName } from '@/components/ui/modal-form-actions';

export interface VaultEmptyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Create a new vault" — the host opens its create form. */
  onCreate: () => void;
  /** "Import a backup" — the host opens its independent-import form. */
  onImport: () => void;
}

export function VaultEmptyDialog({ open, onOpenChange, onCreate, onImport }: VaultEmptyDialogProps) {
  const t = useTranslations('vault');

  const choose = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('emptyTitle')}</DialogTitle>
          <DialogDescription>{t('emptyDescription')}</DialogDescription>
        </DialogHeader>
        <DialogFooter columns={1} className="gap-2">
          <Button
            type="button"
            onClick={() => choose(onCreate)}
            className={modalFormActionButtonClassName}
            data-testid="vault-empty-create"
          >
            <FolderPlus data-icon="inline-start" aria-hidden />
            {t('emptyCreate')}
          </Button>
          <Button
            type="button"
            onClick={() => choose(onImport)}
            className={modalFormActionButtonClassName}
            data-testid="vault-empty-import"
          >
            <Upload data-icon="inline-start" aria-hidden />
            {t('emptyImport')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className={modalFormActionButtonClassName}
          >
            {t('emptyContinue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
