'use client';

// Shared on-chain verification verdict rendering (extracted from R2's
// import-key-dialog for A6-T5's migration dialog — the verdict semantics are
// ONE concern, not a per-dialog copy). Pure presentation over a
// VaultKeyChainMatch: the caller owns the candidate (account + role +
// publicKey) and the on-chain result; this module maps the result to the
// tone + `vault.verify*` i18n message and renders the standard box.
//
// Which message wins (most consequential finding first — see import-key-dialog):
//   1. not on chain                      -> warn (stored, cannot sign);
//   2. matched but sub-threshold         -> warn (signer will reject it);
//   3. matched on a DIFFERENT level than the selected role -> warn (stored
//      under the SELECTED role, acts on chain only as what it really is);
//   4. memo match                        -> ok (encrypts memos, never signs);
//   5. matched, sufficient weight        -> ok.
import { useTranslations } from 'next-intl';
import { AlertTriangle, ShieldCheck } from 'lucide-react';

import type { VaultKeyChainMatch } from '@/lib/vault/key-management';
import type { VaultKeyRole } from '@/lib/vault/types';

/** i18n message keys per vault key role (shared by the vault dialogs). */
export const ROLE_LABEL_KEYS: Record<VaultKeyRole, string> = {
  owner: 'keysRoleOwner',
  active: 'keysRoleActive',
  posting: 'keysRolePosting',
  memo: 'keysRoleMemo',
};

/**
 * `STM` + first 4 + ellipsis + last 4; short values render as-is. Shared
 * truncation for every vault surface rendering a public key (moved here from
 * vault-key-manager.tsx so leaf-ish vault UI modules can import it without a
 * component-to-component cycle).
 */
export function shortPublicKey(publicKey: string): string {
  return publicKey.length <= 12
    ? publicKey
    : `${publicKey.slice(0, 7)}…${publicKey.slice(-4)}`;
}

/** The verification snapshot shown between the check and the confirm. */
export interface VaultKeyVerification {
  accountName: string;
  role: VaultKeyRole;
  publicKey: string;
  result: VaultKeyChainMatch;
}

export interface VaultKeyVerdict {
  tone: 'ok' | 'warn';
  key: string;
  values: Record<string, string>;
}

/** Map a verification result to its tone + i18n message (order matters). */
export function vaultKeyVerdict(
  candidate: VaultKeyVerification,
  roleLabel: (role: VaultKeyRole) => string,
): VaultKeyVerdict {
  const { result } = candidate;
  if (!result.matched) {
    return { tone: 'warn', key: 'verifyNotOnChain', values: {} };
  }
  if (!result.suffices) {
    return {
      tone: 'warn',
      key: 'verifySubthreshold',
      values: {
        authority: roleLabel(result.authority),
        weight: String(result.weight),
        threshold: String(result.threshold),
      },
    };
  }
  if (result.authority !== candidate.role) {
    return {
      tone: 'warn',
      key: 'verifyAuthorityDiffers',
      values: {
        authority: roleLabel(result.authority),
        role: roleLabel(candidate.role),
      },
    };
  }
  if (result.authority === 'memo') {
    return { tone: 'ok', key: 'verifyMemo', values: {} };
  }
  return {
    tone: 'ok',
    key: 'verifyMatched',
    values: {
      authority: roleLabel(result.authority),
      weight: String(result.weight),
      threshold: String(result.threshold),
    },
  };
}

/**
 * The standard verdict box. `testId` defaults to the add-key dialog's marker
 * (its e2e/unit assertions depend on it); the migration dialog passes its own.
 */
export function KeyVerdictBox({
  verification,
  testId = 'vault-add-key-verification',
}: {
  verification: VaultKeyVerification;
  testId?: string;
}) {
  const t = useTranslations('vault');
  const roleLabel = (role: VaultKeyRole): string => t(ROLE_LABEL_KEYS[role]);
  const verdict = vaultKeyVerdict(verification, roleLabel);
  return (
    <div
      className={
        verdict.tone === 'ok'
          ? 'rounded-md border border-emerald-600/40 bg-emerald-600/10 p-3'
          : 'rounded-md border border-amber-500/40 bg-amber-500/10 p-3'
      }
      data-testid={testId}
    >
      <p
        className={
          verdict.tone === 'ok'
            ? 'flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400'
            : 'flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400'
        }
      >
        {verdict.tone === 'ok' ? (
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        {t(verdict.key, verdict.values)}
      </p>
    </div>
  );
}
