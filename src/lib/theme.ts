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

if (typeof window !== 'undefined') {
  const stored = localStorage.getItem(THEME_KEY) as LegacyTheme;
  if (stored && validThemes.includes(stored)) _theme = stored;
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

  // Apply theme class before paint to avoid FOUC.
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
    // Apply immediately so the class change is synchronous (avoids FOUC between
    // the store mutation and the useLayoutEffect running after React re-renders).
    document.documentElement.classList.remove('theme-original', 'theme-light', 'theme-dark');
    document.documentElement.classList.add(`theme-${newTheme}`);
    _listeners.forEach((l) => l());
  }, []);

  const cycleTheme = useCallback(() => {
    const currentIndex = validThemes.indexOf(theme);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % validThemes.length : 0;
    const nextTheme = validThemes[nextIndex];
    if (nextTheme) changeTheme(nextTheme);
  }, [theme, changeTheme]);

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
  if (typeof window === 'undefined') return DEFAULT_THEME;

  const stored = localStorage.getItem(THEME_KEY) as LegacyTheme;
  return stored && validThemes.includes(stored) ? stored : DEFAULT_THEME;
}

/**
 * Utility function to apply theme without hook
 */
export function applyThemeClass(theme: LegacyTheme) {
  if (typeof document === 'undefined') return;

  document.documentElement.classList.remove('theme-original', 'theme-light', 'theme-dark');
  document.documentElement.classList.add(`theme-${theme}`);
}
