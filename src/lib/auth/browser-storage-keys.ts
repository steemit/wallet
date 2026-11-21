/**
 * localStorage key names for the device-remembered login convenience data
 * (username / posting key) — see lib/auth/browser-storage.ts for the storage
 * contract and the accepted-risk evaluation.
 *
 * LEAF MODULE: this file must stay free of imports (in particular of any
 * `@/` alias) so non-bundled consumers — the Playwright e2e specs, which
 * seed real localStorage through the SAME key names the production module
 * uses — can import it under Node without a bundler alias resolver.
 */
export const REMEMBERED_USERNAME_KEY = 'wallet:rememberedUsername';
export const REMEMBERED_POSTING_KEY_KEY = 'wallet:rememberedPostingKey';
