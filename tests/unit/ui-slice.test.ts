/**
 * UI Redux slice unit tests
 */

import { describe, it, expect } from 'vitest';
import uiReducer, {
  toggleSidebar,
  setSidebarOpen,
  setTheme,
  setLocale,
} from '@/lib/store/slices/ui';

const initialState = {
  sidebarOpen: true,
  theme: 'light' as const,
  locale: 'en',
};

describe('UI Slice', () => {
  it('returns the initial state for an unknown action', () => {
    expect(uiReducer(undefined, { type: 'unknown' })).toEqual(initialState);
  });

  it('toggleSidebar flips sidebarOpen', () => {
    const next = uiReducer(initialState, toggleSidebar());
    expect(next.sidebarOpen).toBe(false);

    const back = uiReducer(next, toggleSidebar());
    expect(back.sidebarOpen).toBe(true);
  });

  it('setSidebarOpen sets sidebarOpen to the payload value', () => {
    expect(uiReducer(initialState, setSidebarOpen(false)).sidebarOpen).toBe(false);
    expect(uiReducer(initialState, setSidebarOpen(true)).sidebarOpen).toBe(true);
  });

  it('setTheme updates the theme', () => {
    expect(uiReducer(initialState, setTheme('dark')).theme).toBe('dark');
    expect(uiReducer(initialState, setTheme('light')).theme).toBe('light');
  });

  it('setLocale updates the locale', () => {
    expect(uiReducer(initialState, setLocale('zh')).locale).toBe('zh');
    expect(uiReducer(initialState, setLocale('en')).locale).toBe('en');
  });
});
