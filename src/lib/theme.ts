'use client';

import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';

export type LegacyTheme = 'original' | 'light' | 'dark';

const THEME_KEY = 'wallet-theme';
const validThemes: LegacyTheme[] = ['original', 'light', 'dark'];

/** Default day theme — wallet-legacy uses `theme-light` only (see App.jsx), not `theme-original`. */
const DEFAULT_THEME: LegacyTheme = 'light';

// Module-level store so useSyncExternalStore can subscribe to mutations.
// Initialized from localStorage at module load time on the client — the
// server always returns DEFAULT_THEME via getServerSnapshot, so hydration
// produces the same tree the server sent before React switches to the real value.
let _theme: LegacyTheme = DEFAULT_THEME;
const _listeners = new Set<() => void>();

function _notify() {
  // Snapshot the set before iterating so a listener that calls unsubscribe
  // (deleting itself from _listeners mid-loop) doesn't skip subsequent entries.
  Array.from(_listeners).forEach((l) => l());
}

if (typeof window !== 'undefined') {
  const stored = localStorage.getItem(THEME_KEY) as LegacyTheme;
  if (stored && validThemes.includes(stored)) _theme = stored;

  // Keep tabs in sync: when another tab writes to THEME_KEY, update the
  // module store and notify all subscribers in this tab.
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY && e.newValue && validThemes.includes(e.newValue as LegacyTheme)) {
      _theme = e.newValue as LegacyTheme;
      _notify();
    }
  });
}

function _subscribeTheme(cb: () => void) {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

function _getThemeSnapshot(): LegacyTheme { return _theme; }
function _getThemeServerSnapshot(): LegacyTheme { return DEFAULT_THEME; }

/**
 * Hook for managing legacy wallet themes (original, light, dark)
 */
export function useTheme() {
  const theme = useSyncExternalStore(_subscribeTheme, _getThemeSnapshot, _getThemeServerSnapshot);

  // Safety net: ensures the correct class is on <html> at mount and whenever
  // theme changes (e.g. cross-tab sync). changeTheme also applies the class
  // synchronously to prevent FOUC — the duplication is intentional.
  useLayoutEffect(() => {
    document.documentElement.classList.remove('theme-original', 'theme-light', 'theme-dark');
    document.documentElement.classList.add(`theme-${theme}`);
  }, [theme]);

  const changeTheme = useCallback((newTheme: LegacyTheme) => {
    if (!validThemes.includes(newTheme)) {
      console.warn(`Invalid theme: ${newTheme}. Valid themes are: ${validThemes.join(', ')}`);
      return;
    }
    _theme = newTheme;
    localStorage.setItem(THEME_KEY, newTheme);
    // Apply immediately to avoid FOUC between this call and the useLayoutEffect
    // that fires after React processes the re-render triggered by _notify().
    document.documentElement.classList.remove('theme-original', 'theme-light', 'theme-dark');
    document.documentElement.classList.add(`theme-${newTheme}`);
    _notify();
  }, []);

  // Reads _theme directly from the module store so this callback is stable —
  // it doesn't close over the `theme` snapshot and won't invalidate memoized
  // children that receive cycleTheme as a prop.
  const cycleTheme = useCallback(() => {
    const currentIndex = validThemes.indexOf(_theme);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % validThemes.length : 0;
    const nextTheme = validThemes[nextIndex];
    if (nextTheme) changeTheme(nextTheme);
  }, [changeTheme]);

  return {
    theme,
    changeTheme,
    cycleTheme,
    themes: validThemes,
  };
}

/**
 * Utility function to get the current theme (for SSR compatibility)
 */
export function getCurrentTheme(): LegacyTheme {
  return _theme;
}

/**
 * Utility function to apply theme without hook
 */
export function applyThemeClass(theme: LegacyTheme) {
  if (typeof document === 'undefined') return;

  document.documentElement.classList.remove('theme-original', 'theme-light', 'theme-dark');
  document.documentElement.classList.add(`theme-${theme}`);
}
