/**
 * Window events around the Work Mode modal (the listener / dispatcher lives
 * in app-layout.tsx). Extracted to a leaf module so surfaces rendered INSIDE
 * the layout — the R3 vault login form, the B-phase dapp hook — can reference
 * the constants without importing the whole layout (which would create an
 * import cycle: layout -> header -> login form -> vault login form ->
 * layout). app-layout.tsx re-exports the OPEN constant to keep the historical
 * `import { VAULT_WORK_MODE_OPEN_EVENT } from 'app-layout'` contract intact.
 *
 * Deliberately bare custom events (no payload). If a caller ever needs to
 * convey WHICH error occurred, extend the event detail then.
 */

/** Dispatch on `window` to open the Work Mode modal and focus the mode switcher. */
export const VAULT_WORK_MODE_OPEN_EVENT = 'steem-wallet:open-work-mode';

/**
 * Dispatched on `window` by the layout whenever the Work Mode modal closes.
 * Every vault management action (create / import / merge / add or remove a
 * key / rename / delete) happens inside that modal, so its closing is the
 * moment vault-derived views outside it (the R3 vault login form) re-read
 * the public directory. Only same-tab changes are covered; other tabs are
 * the consumer's concern (e.g. `visibilitychange`).
 */
export const VAULT_WORK_MODE_CLOSED_EVENT = 'steem-wallet:work-mode-closed';
