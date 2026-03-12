'use client';

/**
 * Theme Switcher Component
 *
 * Allows users to switch between original, light, and dark themes
 */

import { useTheme } from '@/lib/theme';

export function ThemeSwitcher() {
  const { theme, changeTheme, isMounted } = useTheme();

  if (!isMounted) {
    return null;
  }

  const themes = [
    { id: 'original' as const, name: 'Original', color: '#004EFF' },
    { id: 'light' as const, name: 'Light', color: '#06D6A9' },
    { id: 'dark' as const, name: 'Dark', color: '#1C252B' },
  ];

  return (
    <div className="flex items-center gap-2">
      {themes.map((t) => (
        <button
          key={t.id}
          onClick={() => changeTheme(t.id)}
          className={`
            relative flex h-8 w-8 items-center justify-center rounded-full
            transition-all duration-200
            ${theme === t.id ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-600' : ''}
          `}
          style={{ backgroundColor: t.color }}
          title={t.name}
        >
          {theme === t.id && (
            <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap">
              {t.name}
            </span>
          )}
          <span className="sr-only">{t.name}</span>
        </button>
      ))}
    </div>
  );
}
