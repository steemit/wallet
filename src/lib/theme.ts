'use client';

import { useLayoutEffect, useState } from 'react';

export type LegacyTheme = 'original' | 'light' | 'dark';

const THEME_KEY = 'wallet-theme';
const validThemes: LegacyTheme[] = ['original', 'light', 'dark'];

/** Default day theme — wallet-legacy uses `theme-light` only (see App.jsx), not `theme-original`. */
const DEFAULT_THEME: LegacyTheme = 'light';

/**
 * Hook for managing legacy wallet themes (original, light, dark)
 */
export function useTheme() {
  const [theme, setThemeState] = useState<LegacyTheme>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    const stored = localStorage.getItem(THEME_KEY) as LegacyTheme;
    return stored && validThemes.includes(stored) ? stored : DEFAULT_THEME;
  });

  const applyTheme = (newTheme: LegacyTheme) => {
    // Remove all theme classes
    document.documentElement.classList.remove('theme-original', 'theme-light', 'theme-dark');

    // Add new theme class
    document.documentElement.classList.add(`theme-${newTheme}`);
  };

  // Apply theme class before paint to avoid FOUC.
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const changeTheme = (newTheme: LegacyTheme) => {
    if (!validThemes.includes(newTheme)) {
      console.warn(`Invalid theme: ${newTheme}. Valid themes are: ${validThemes.join(', ')}`);
      return;
    }

    setThemeState(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
    applyTheme(newTheme);
  };

  const cycleTheme = () => {
    const currentIndex = validThemes.indexOf(theme);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % validThemes.length : 0;
    const nextTheme = validThemes[nextIndex];
    if (nextTheme) changeTheme(nextTheme);
  };

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
