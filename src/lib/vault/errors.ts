// Vault error class (A0 baseline).
//
// `VaultError.code` is a machine-readable code for UI routing and tests.
// User-visible error text goes through i18n — never surface the English
// error code directly as user-facing copy for all locales.
import type { VaultErrorCode } from './types';

export class VaultError extends Error {
  constructor(
    public readonly code: VaultErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}
