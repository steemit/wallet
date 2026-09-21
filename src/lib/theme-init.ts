/**
 * Server-safe theme constants and the no-FOUC init script (finding K-5).
 *
 * This module must stay free of 'use client' (and of any browser access at
 * import time): the root layout imports it on the server to inline the
 * script into the SSR HTML. lib/theme.ts (client) imports the constants so
 * the storage key, valid values, and default can never drift apart.
 */

export const THEME_STORAGE_KEY = 'wallet-theme';

export const VALID_THEMES = ['original', 'light', 'dark'] as const;
export type LegacyTheme = (typeof VALID_THEMES)[number];

/** Default day theme — wallet-legacy uses `theme-light` only (see App.jsx), not `theme-original`. */
export const DEFAULT_THEME: LegacyTheme = 'light';

/**
 * Inline blocking script rendered as the first child of <body>. It applies
 * the persisted theme class to <html> during HTML parsing, before the first
 * paint — without it, dark-theme users get a white flash on every full page
 * load, because lib/theme.ts only touches the DOM after hydration.
 *
 * Written defensively: localStorage can throw (private mode / disabled
 * storage) and an unknown stored value must fall back to the default. The
 * script is emitted raw into the page, so it must not interpolate anything
 * runtime-derived — it is a constant.
 */
export const THEME_INIT_SCRIPT = `(function () {
  try {
    var t = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (t !== 'original' && t !== 'light' && t !== 'dark') t = '${DEFAULT_THEME}';
    document.documentElement.classList.add('theme-' + t);
  } catch (e) {
    document.documentElement.classList.add('theme-${DEFAULT_THEME}');
  }
})();`;
